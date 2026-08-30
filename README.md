# Pipe Talk

Pipe Talk is a lightweight, terminal-based messaging and file-transfer tool for
people on the same reachable network. A central TCP server keeps track of
connected users and relays direct messages, files, and folders between clients.

It is designed for quick, interactive sharing on trusted networks—no account,
database, or browser required.

## Features

- Direct messages between connected users
- Live list of online users
- File transfers, including empty files
- Folder transfers with transferred-file hierarchy preserved
- Upload and download progress indicators
- Backpressure handling while files are relayed
- Transfer cancellation when either participant disconnects
- IPv4 and IPv6 literal validation in the client

## How it works

The server is a relay. It keeps connected user IDs in memory and forwards each
message or file chunk to its intended recipient; it does not persist chats or
uploads to disk.

```text
Client A (terminal) ── TCP / JSON Lines ──> Pipe Talk server ── TCP / JSON Lines ──> Client B (terminal)
       │                                                                                     │
       └──────── reads local files ─────────────── file chunks ──────────────── writes local files ─┘
```

The default server port is TCP `4000`. User IDs are unique only for the current
server session and are released when a client disconnects.

## Requirements

- Node.js 20 or later (Node.js 22 LTS is recommended)
- A network path from every client to the server on its configured TCP port

## Quick start

Install dependencies and build the project on the server and every client
machine:

```sh
npm install
npm run build
```

On the machine hosting the relay, start the server:

```sh
npm run start:server
```

The server listens on all IPv4 interfaces at the default port, `4000`. Allow
inbound TCP traffic to that port through the host firewall when clients are on
another machine.

If the default port is already in use, choose a port from `1` through `65535`:

```sh
PORT=4001 npm run start:server
```

On each client machine, start a client with the server's IP address:

```sh
npm run start:client -- 192.168.1.4
```

The `--` is required by npm to forward the address to the client process. The
client accepts either an IPv4 or IPv6 literal. When the server uses a custom
port, pass that same port to every client:

```sh
PORT=4001 npm run start:client -- 192.168.1.4
```

The client accepts either an IPv4 or IPv6 literal:

```sh
npm run start:client -- 2001:db8::10
```

> The bundled server currently binds to `0.0.0.0` (IPv4). An IPv6 client
> address is useful when connecting to a Pipe Talk server configured to listen
> over IPv6.

Each client is prompted to choose a unique user ID after connecting.

## Using the client

| Input | Description |
| --- | --- |
| `list users` or `lu` | Show everyone currently connected, except you. |
| `<user>: <message>` | Send a direct message. |
| `<user>: -f <file-path>` | Send one file. Paths containing spaces may be quoted. |
| `<user>: -f <folder-path>` | Send every file in a folder, preserving its file hierarchy. |
| `clear` or `clr` | Clear the terminal and show the command list again. |

Examples:

```text
alex: Hi, are you available for a quick sync?
alex: -f ./docs/project-brief.pdf
alex: -f "./release assets"
lu
```

Incoming files are written relative to the receiving client's current working
directory. A single file keeps its filename; a folder transfer recreates the
root folder and relative paths for its files. Existing files at the destination
can be overwritten, so run the client from a suitable directory.

## Development

Run the TypeScript source directly with file watching:

```sh
npm run dev:server
npm run dev:client -- 192.168.1.4
```

The development commands accept the same `PORT` setting. For example, to use
port `4001`:

```sh
PORT=4001 npm run dev:server
PORT=4001 npm run dev:client -- 192.168.1.4
```

Build the production JavaScript output in `dist/`:

```sh
npm run build
```

## Project structure

```text
src/
├── server.ts                   # TCP server lifecycle and connection cleanup
├── server-request-handlers.ts  # User registry, message routing, file relaying
├── client.ts                   # Client connection lifecycle and terminal input
├── client-request-handlers.ts  # Incoming messages, downloads, and reconnect UI
├── helper.ts                   # Protocol framing, commands, transfers, progress
├── globals.ts                  # In-memory clients and active-transfer state
├── types.ts                    # Message, command, socket, and transfer types
└── constants.ts                # Terminal colors, prompts, and command text
```

`package.json` provides the development, build, and production start commands.
`tsconfig.json` compiles the NodeNext TypeScript source into `dist/`.

## Security and operating limits

Pipe Talk is intended for trusted networks only. It currently has no
authentication, authorization, transport encryption, persistent history, or
malware scanning. Anyone able to reach the server can attempt to claim a user
ID and exchange data with connected clients.

Use a VPN or another protected network boundary when sharing sensitive files.
For Internet-facing use, add authentication, TLS, strict receive-path
validation, access controls, and audit logging first. Transfers are not resumed
after a disconnect; the sender must start them again. Empty directories are not
transferred.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Client prints the usage message | Use `npm run start:client -- <server-ip-address>` and provide a valid IP literal. Set `PORT=<port>` first when using a custom port. |
| Client cannot connect | Confirm the server is running, the address and port match, and that TCP port is allowed through firewalls. |
| Server says the port is in use | Start it with another port, for example `PORT=4001 npm run start:server`, then give clients the same port. |
| A recipient is unavailable | Run `lu` and use the exact online user ID. |
| A transfer is cancelled | Keep both clients connected until it completes, then send the file or folder again. |
