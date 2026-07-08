# VM Backend Service

The private bridge between the Next.js app and SQL Server.

```
Browser → Next.js (Vercel API routes) → ngrok → [this service] → SQL Server
```

Next.js never connects to SQL Server directly. This service runs on a machine
with private network access to the database, owns the connection string, and
exposes a small authenticated HTTP API that the Next.js app calls over an ngrok
tunnel.

## Endpoints

| Method | Path          | Body                                   | Response               |
| ------ | ------------- | -------------------------------------- | ---------------------- |
| GET    | `/api/health` | —                                      | `{ status, database }` |
| POST   | `/api/query`  | `{ sql, params:[{name,value,type}] }`  | `{ recordset, rowCount, truncated }` |

Every `/api/*` request must send `Authorization: Bearer <API_KEY>`.

Only single read-only `SELECT` / `WITH … SELECT` statements are accepted; any
mutation, multi-statement, or dangerous keyword is rejected. Parameters are
always bound server-side — never string-interpolated.

## Setup (on the VM / DB host)

```bash
cd vm-backend
cp .env.example .env      # fill in DB creds; API_KEY must match the app
npm install
node --env-file=.env server.mjs
```

Then expose it with ngrok (point the tunnel at THIS service's port, not 1433):

```bash
ngrok http 8080
```

Take the resulting `https://<subdomain>.ngrok-free.dev` URL and set it as
`BACKEND_URL` in the Next.js app's environment. Set the same secret as
`BACKEND_API_KEY` in the app.

## App-side env vars (already configured in this project)

| Var                  | Value                                            |
| -------------------- | ------------------------------------------------ |
| `BACKEND_URL`        | `https://mollusk-clip-bullion.ngrok-free.dev`    |
| `BACKEND_API_KEY`    | matches `API_KEY` here                           |
| `BACKEND_QUERY_PATH` | `/api/query` (default)                           |
| `BACKEND_HEALTH_PATH`| `/api/health` (default)                          |

## Common mistake

`ERR_NGROK_8012 … upstream localhost:1433` means ngrok is tunneling directly to
SQL Server. Point ngrok at **this service** (e.g. `ngrok http 8080`) instead —
SQL Server speaks TDS, not HTTP, so an HTTP tunnel to 1433 can never work.
