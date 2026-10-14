import { addPlayer, idleInput, makeGame, sanitizeInput, stepGame, type GameState } from '../src/game';

interface Env { ASSETS: Fetcher; RAID_ROOMS: DurableObjectNamespace }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return Response.json({ ok: true, multiplayer: true });
    if (url.pathname === '/api/raid') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
      const room = url.searchParams.get('room') || 'blackpine';
      if (!/^[a-zA-Z0-9-]{1,24}$/.test(room)) return new Response('Invalid room name', { status: 400 });
      return env.RAID_ROOMS.get(env.RAID_ROOMS.idFromName(room)).fetch(request);
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class RaidRoom {
  private game: GameState = makeGame(true);
  private clients = new Map<WebSocket, { id: string; lastInput: number; lastMessage: number }>();
  private timer: ReturnType<typeof setInterval> | undefined;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (this.clients.size >= 8) return new Response('This raid is full (8/8)', { status: 503 });
    if (this.clients.size === 0) this.game = makeGame(true);
    if (this.game.ended || this.game.duration - this.game.time < 60) return new Response('Raid is ending. Try another room.', { status: 409 });
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const id = crypto.randomUUID();
    const name = (url.searchParams.get('name') || '名もなき旅人').replace(/[<>\u0000-\u001f]/g, '').slice(0, 16);
    const primary = url.searchParams.get('weapon') === 'katana' ? 'katana' : 'sword';
    addPlayer(this.game, id, name, primary);
    this.clients.set(server, { id, lastInput: Date.now(), lastMessage: 0 });
    server.send(JSON.stringify({ type: 'joined', id, state: this.game }));
    server.addEventListener('message', (event: MessageEvent) => {
      const info = this.clients.get(server);
      if (!info || typeof event.data !== 'string' || event.data.length > 1024) return;
      const now = Date.now();
      if (now - info.lastMessage < 20) return;
      info.lastMessage = now;
      try {
        const message = JSON.parse(event.data);
        const p = this.game.players.find(p => p.id === id);
        if (message.type === 'input' && p) { p.input = sanitizeInput(message.input, p.primary); info.lastInput = now; }
      } catch { /* Malformed client packets never affect room state. */ }
    });
    const close = () => {
      if (!this.clients.has(server)) return;
      this.clients.delete(server);
      const p = this.game.players.find(p => p.id === id);
      if (p?.status === 'alive' && p.bag.length) this.game.loot.push({ id: `disconnect-${id}`, x: p.x, y: p.y, items: p.bag, opened: false, kind: 'body' });
      this.game.players = this.game.players.filter(p => p.id !== id);
      if (!this.clients.size && this.timer) { clearInterval(this.timer); this.timer = undefined; }
    };
    server.addEventListener('close', close);
    server.addEventListener('error', close);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 50);
    return new Response(null, { status: 101, webSocket: client });
  }

  private tick() {
    const now = Date.now();
    for (const [socket, info] of this.clients) {
      const p = this.game.players.find(p => p.id === info.id);
      if (p && now - info.lastInput > 400) p.input = { ...idleInput(), weapon: p.weapon, angle: p.angle };
      if (now - info.lastInput > 60000) socket.close(1000, 'Inactive');
    }
    stepGame(this.game, .05);
    const snapshot = JSON.stringify({ type: 'state', state: this.game });
    for (const socket of this.clients.keys()) {
      try { socket.send(snapshot); } catch { socket.close(1011, 'Connection lost'); }
    }
  }
}
