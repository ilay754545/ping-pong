import asyncio
import http.server
import socket
import socketserver
import threading
import json
import websockets

# --- CONFIG ---
HTTP_PORT = 8001
WS_PORT = 8765

def get_local_ip():
    try:
        # Create a dummy socket to find the local IP address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class QuietHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silence HTTP logs unless you want to see them
        pass

def run_http_server():
    Handler = QuietHTTPRequestHandler
    with socketserver.TCPServer(("", HTTP_PORT), Handler) as httpd:
        print(f"[HTTP] Serving at http://{get_local_ip()}:{HTTP_PORT}")
        httpd.serve_forever()

# --- WEBSOCKET RELAY ---
clients = []

async def relay(websocket):
    global clients
    clients.append(websocket)
    role = "host" if len(clients) == 1 else "guest"
    
    # Send role assignment
    await websocket.send(json.dumps({"type": "init", "role": role}))
    print(f"[WS] Client connected as {role}. Total: {len(clients)}")

    try:
        async for message in websocket:
            # Broadcast to all OTHER clients
            other_clients = [c for c in clients if c != websocket]
            if other_clients:
                # In this simple relay, we just send to everyone else
                await asyncio.gather(*[c.send(message) for c in other_clients])
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.remove(websocket)
        print(f"[WS] Client disconnected. Total: {len(clients)}")

async def run_ws_server():
    print(f"[WS] Relay running on ws://{get_local_ip()}:{WS_PORT}")
    async with websockets.serve(relay, "0.0.0.0", WS_PORT):
        await asyncio.Future()  # run forever

def main():
    print("--- Ultimate Ping Pong LAN Server ---")
    local_ip = get_local_ip()
    print(f"Share this address with the other player: http://{local_ip}:{HTTP_PORT}")
    
    # Run HTTP in a background thread
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()

    # Run WebSocket in main loop
    try:
        asyncio.run(run_ws_server())
    except KeyboardInterrupt:
        print("\nStopping server...")

if __name__ == "__main__":
    main()
