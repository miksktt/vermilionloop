# The Vermilion Loop: Online VR

Two players share one world, with any combination of Quest VR and desktop browser. This package preserves the four environments, Surveyors / Tag, three-lap hover racing with ordered checkpoints, free flying, temporary steps, charged cubes, NPCs and both sets of power-ups.

## Updating an existing Render deployment

This repair fixes room creation stalling on the server. It replaces the expensive recursive collision index with a spatial grid over the same triangles, and runs each world in a worker thread so that health checks and connections remain responsive.

1. Extract the latest ZIP. Upload **all the contents of its inner folder** to the same GitHub repository, replacing the old files. Keep the `public` folder and the new `simulation-runner.mjs` and `simulation-worker.mjs` files.
2. Keep your existing Render root directory and environment settings. Use build command `npm install --omit=dev` and start command `npm start`.
3. Redeploy the latest commit in Render. Refresh the game with Ctrl+Shift+R after it finishes.
4. Opening `/health` after your site's address should show build `online-vr-20261120-room-startup-fix`. That confirms that the repaired server is running.

Room creation now shows a preparation message instead of a generic sleeping-server error. The repair doesn't require a paid hosting plan or a database.

## The easiest hosting route: Render

Use a **Node Web Service**. It serves the website and the multiplayer WebSocket connection together. A static HTML host alone cannot run the multiplayer simulation.

1. Extract this ZIP on your computer.
2. Create a GitHub repository. Upload the extracted contents so that `package.json`, `server.mjs`, `simulation.mjs` and the `public` folder are at the repository root. Upload the files themselves, not the ZIP. Keep the structure intact.
3. Sign in to [Render](https://render.com) and choose **New > Web Service**. Connect that GitHub repository.
4. Enter these settings:

| Setting | Value |
| --- | --- |
| Runtime / language | Node |
| Root directory | Leave blank, if package.json is at the repository root |
| Build command | `npm install --omit=dev` |
| Start command | `npm start` |
| Health check path | `/health` |
| Environment variable | `NODE_VERSION=22` |
| Environment variable | `MAX_ROOMS=2` |
| Number of instances | **1** |

5. Choose a compute plan and deploy. The included `render.yaml` also supports deployment through Render Blueprints. It uses the Free plan for an initial trial. Render's free service can sleep when idle and takes time to wake. An always-on paid instance suits regular sessions.
6. Open the HTTPS address Render supplies. Both players use that exact website address. No separate front-end deployment, database, Meta store app, router port forwarding or server URL entry is needed for this setup.

Create and join rooms only after the service has finished waking up. Forming a new world can take several seconds.

## Starting a two-player game

1. Player one opens the hosted website, chooses the environment and play mode, then selects **Create online room**.
2. Player one shares the six-character code, or uses **Copy invite**.
3. Player two opens the same website and selects **Join** with that code. The game starts when both worlds are ready.
4. A headset player opens the site in **Meta Quest Browser**, then selects **Enter VR**. The other player may stay on a normal computer. Two Quest players each enter VR on their own headset.

The devices can use different networks and be in different locations. A computer does not need to stay on when two Quests use the hosted server.

## Controls

| Action | Quest | Desktop |
| --- | --- | --- |
| Move | Left thumbstick | WASD |
| Look | Turn your head | Mouse, after clicking the view |
| Turn | Right thumbstick, 30-degree snap turns | Mouse |
| Build a block | **Left trigger**, aim the left controller | **E** or left mouse |
| Throw cube | **Right trigger**, release to throw | **F** or right mouse, release to throw |
| Charge cube | Hold the right trigger, then release | Hold F or right mouse, then release |
| Jump | Right A | Space |
| Run / boost | Right B toggles, or hold left stick click | Shift |
| Build preview | Left X | B |
| Menu | **Left Y** | Esc or Tab, or Menu button |

In the VR menu, aim either controller at a button and press its trigger. The menu provides Resume, Recentre View and Leave Room / Main Menu. The left controller determines build direction. The right controller determines cube origin and aim. A normal connected gamepad also works on desktop.

For racing and free flying, use the left stick or WASD to thrust, brake and steer. Desktop mouse movement controls heading and climb. In VR, head direction controls flight direction, with right-stick turning. Run becomes boost.

Temporary blocks last 30 seconds. Crystals grant the original power-ups. Shrink is one third size and grow is three times size. Growth waits if there isn't enough physical clearance. The controller input routing follows left/right handedness rather than controller connection order.

## What was changed in the collisions

- The physics ground follows the same triangular surface as the displayed terrain. All four maps repeat without a height jump at the loop boundary.
- Walking uses a swept capsule with distance-based substeps, floor and ceiling responses, support checks and stair stepping.
- Solid towers and fragments use fixed transforms so their collision shapes stay aligned with their appearance.
- Solid geometry is taken from the actual building meshes, including city gateway pillars and lintels, roof additions, tree trunks and rocks. Foliage, light beams, checkpoint gate effects and other decorative particles remain non-solid.
- Both walking players and flying vehicles collide with solid structures. Ships use a conservative sphere large enough to include the wings and nose.
- Fast cubes use short collision substeps and their actual charged-cube radius. A blocked throwing hand can't spawn a cube beyond a wall.
- Room-scale head movement is included in collision-controlled movement. The VR rig offsets tracking movement when the body is blocked.
- Players can touch and overlap enough to transfer the tag, as in the original game.

## Server behaviour

Each room runs in its own worker thread. The Node server remains available while a world is being prepared. The shared simulation runs at 60 steps per second and sends snapshots at 20 updates per second. Each player predicts their own movement locally. The server decides blocks, projectiles, pickups, tag transfers and race progress.

If a connection drops, the room pauses and the client attempts to reconnect. A reserved seat lasts about 90 seconds, subject to the server's cleanup interval. Keep the original page open for automatic reconnection. Leaving explicitly closes the room. Rooms live in memory, so restarting, redeploying or sleeping the server ends current matches. Keep this version on one server instance. It doesn't need a database for normal play.

The room code is intended for casual private matches. There are no accounts or persistent saves. Default limits allow a few rooms, and `MAX_ROOMS` can reduce that limit on smaller hosting plans.

## Running on a computer for testing

Install Node.js 22 or newer from [nodejs.org](https://nodejs.org). Open a terminal in the extracted folder:

```bash
npm ci
npm start
```

Open `http://localhost:3000` on that computer. Two desktop browser tabs can test the room system. Select **Explore solo / Test controls** to inspect a world without a server connection.

A Quest connecting over Wi-Fi normally needs a trusted **HTTPS** address for immersive VR. `http://192.168...:3000` is not sufficient for normal headset WebXR. Use the hosted HTTPS URL, a properly configured HTTPS reverse proxy, or an HTTPS tunnel for development. Do not bypass certificate warnings.

## Other hosts

The supplied Dockerfile can run this game on a container host, Railway, Fly.io or your own VPS. The host must run a persistent Node process, support WebSocket upgrades on the same port as HTTP, and expose trusted HTTPS / WSS. It must honour the `PORT` environment variable. Run one instance.

GitHub Pages and other static-only hosts can serve client files, but they still need a separate running Node server. The one-service Render route above avoids that extra setup.

## Optional single-file HTML

`The_Vermilion_Loop_Online_VR.html` is a convenience copy with all browser code embedded. It can run solo practice when opened directly in a compatible browser. It does not replace `server.mjs` or the multiplayer service.

For online play from that separate file, enter the hosted server's HTTPS address under **Separate server address** and configure the server's `ALLOWED_ORIGINS` environment variable. For a local downloaded file the origin is `null`. For an independently hosted client, use its exact origin, for example `https://your-client.example`. Multiple entries are comma-separated. Leave this setting empty for the recommended same-website setup. Use the server's hosted page for normal Quest play.

## Verification

Run:

```bash
npm test
```

The tests cover real two-client WebSocket play, room limits, shared throws, movement synchronisation, reconnection, responsive health checks and pings during room preparation, clear client errors, handed VR controller routing, terrain triangle agreement, walls, roofs, gateway openings, stairs, expiring steps, size changes, world seams and boosted ship impacts.

This build has automated physics and networking verification. The available preview browser could not create a WebGL graphics context, so a full visual play-through wasn't possible there. Actual Quest controller ergonomics, headset performance, comfort and play over your chosen hosting region still require testing on the headset. Collision checks don't establish that every possible geometry and network condition is bug-free.

## Reference documentation

- [Render: Node web service deployment](https://render.com/docs/deploy-node-express-app)
- [Render: WebSockets](https://render.com/docs/websocket)
- [Render: Free service behaviour](https://render.com/docs/free)
- [Meta: WebXR overview](https://developers.meta.com/vr/documentation/web/webxr-overview/)

Three.js and its collision helpers use the MIT licence. See THIRD_PARTY_LICENSES.txt. The multiplayer transport dependency is ws, also MIT licensed.
