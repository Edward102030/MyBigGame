/**
 * ═══════════════════════════════════════════════════════════════
 * REALM ENGINE — game.js
 * ═══════════════════════════════════════════════════════════════
 *
 * Architecture Overview:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  REALM (global namespace)                                   │
 * │  ├── Camera      : pan, zoom, isometric projection         │
 * │  ├── World       : tile grid, buildings, units             │
 * │  ├── Renderer    : painter's algorithm, frustum culling    │
 * │  ├── AI          : heuristic agents for 4 factions         │
 * │  ├── Combat      : math-driven resolution                  │
 * │  ├── HUD         : DOM refs, resource display              │
 * │  ├── Input       : touch pan/pinch, tap detection          │
 * │  └── Save        : JSON serialise ↔ localStorage           │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Coordinate system:
 *   World grid   : integer (gx, gy) — origin top-left
 *   Isometric    : IsoX = (gx - gy) * TILE_W/2
 *                  IsoY = (gx + gy) * TILE_H/2 − (gz * Z_SCALE)
 *   Screen       : sx = IsoX * camera.zoom + camera.panX + cx
 *                  sy = IsoY * camera.zoom + camera.panY + cy
 *
 * Painter's order: sort by (gx + gy) ascending, then by gy.
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     0. CONSTANTS
  ═══════════════════════════════════════════════════════════ */

  const GRID_W   = 32;      // world columns
  const GRID_H   = 32;      // world rows
  const TILE_W   = 96;      // isometric tile pixel width  (flat top)
  const TILE_H   = 48;      // isometric tile pixel height (flat top)
  const Z_SCALE  = 28;      // pixels per elevation unit
  const MAX_Z    = 3;       // maximum terrain height
  const FPS_CAP  = 60;
  const AI_COUNT = 4;       // AI factions (0=player, 1-4=AI)

  // Terrain types
  const T = {
    WATER:    0,
    PLAINS:   1,
    FOREST:   2,
    HILLS:    3,
    MOUNTAIN: 4,
    DESERT:   5,
    SNOW:     6,
  };

  // Building types
  const B = {
    NONE:       0,
    SETTLEMENT: 1,
    FARM:       2,
    MINE:       3,
    BARRACKS:   4,
    TOWER:      5,
    CAPITAL:    6,
    PORT:       7,
  };

  // Faction colours (index 0=player)
  const FACTION_COLORS = ['#4a90d9','#d94a4a','#4ad95c','#d9c44a','#a04ad9'];
  const FACTION_NAMES  = ['Player','Crimson','Verdant','Amber','Violet'];

  /* ═══════════════════════════════════════════════════════════
     1. WORLD DATA STRUCTURES
  ═══════════════════════════════════════════════════════════ */

  /**
   * Tile schema:
   * {
   *   t:  terrain type  (T.*)
   *   z:  elevation     (0-3)
   *   b:  building type (B.*)
   *   f:  faction owner (0=none, 1-5)
   *   u:  unit strength (0 = no unit)
   *   uf: unit faction
   *   cd: build cooldown remaining turns
   * }
   */

  const World = {
    grid: [],       // flat array [gy * GRID_W + gx]
    turn: 1,
    resources: [    // indexed by faction (0=player)
      { gold: 50, food: 30, prod: 20 },
      { gold: 40, food: 25, prod: 15 },
      { gold: 40, food: 25, prod: 15 },
      { gold: 40, food: 25, prod: 15 },
      { gold: 40, food: 25, prod: 15 },
    ],
    level: 1,
    era: 0,         // 0=Iron,1=Medieval,2=Renaissance,3=Industrial
    ERA_NAMES: ['Age of Iron','Medieval Age','Renaissance','Industrial Age'],
    ERA_THRESHOLDS: [0, 15, 30, 50],

    idx(gx, gy) { return gy * GRID_W + gx; },

    get(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return null;
      return this.grid[this.idx(gx, gy)];
    },

    set(gx, gy, data) {
      if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return;
      Object.assign(this.grid[this.idx(gx, gy)], data);
    },

    // Yield per tile per turn for a faction
    yieldFor(tile) {
      const terrainGold  = [0,1,0,2,3,1,0];
      const terrainFood  = [0,3,2,1,0,1,0];
      const terrainProd  = [0,0,1,2,3,0,0];
      const buildGold    = [0,2,0,3,1,2,4,3];
      const buildFood    = [0,1,4,0,0,0,2,1];
      const buildProd    = [0,0,1,3,2,0,2,1];
      return {
        gold: terrainGold[tile.t] + buildGold[tile.b],
        food: terrainFood[tile.t] + buildFood[tile.b],
        prod: terrainProd[tile.t] + buildProd[tile.b],
      };
    },

    // Collect resources for one faction
    collectResources(faction) {
      let dg = 0, df = 0, dp = 0;
      for (let i = 0; i < this.grid.length; i++) {
        const tile = this.grid[i];
        if (tile.f === faction) {
          const y = this.yieldFor(tile);
          dg += y.gold; df += y.food; dp += y.prod;
        }
      }
      const r = this.resources[faction];
      r.gold = Math.min(r.gold + dg, 9999);
      r.food = Math.min(r.food + df, 9999);
      r.prod = Math.min(r.prod + dp, 9999);
    },

    // Check era progression (by player tiles owned)
    checkEra() {
      let tiles = 0;
      for (let i = 0; i < this.grid.length; i++) {
        if (this.grid[i].f === 0) tiles++;
      }
      for (let e = this.ERA_THRESHOLDS.length - 1; e >= 0; e--) {
        if (tiles >= this.ERA_THRESHOLDS[e]) { this.era = e; break; }
      }
    },

    // Serialise for save
    serialise() {
      return JSON.stringify({
        grid: this.grid,
        turn: this.turn,
        resources: this.resources,
        level: this.level,
        era: this.era,
      });
    },

    // Restore from save
    deserialise(json) {
      try {
        const d = JSON.parse(json);
        this.grid      = d.grid;
        this.turn      = d.turn;
        this.resources = d.resources;
        this.level     = d.level || 1;
        this.era       = d.era   || 0;
        return true;
      } catch (e) { return false; }
    },
  };

  /* ── Procedural World Generator ────────────────────────── */
  function generateWorld() {
    World.grid = [];

    // Simple layered noise using sine waves (no deps)
    function pseudoNoise(x, y, seed) {
      const v = Math.sin(x * 0.3 + seed) * Math.cos(y * 0.3 + seed * 1.3) +
                Math.sin(x * 0.7 + seed * 0.5) * 0.5 +
                Math.cos(y * 0.13 + seed * 2.1) * 0.3;
      return (v + 1.8) / 3.6;   // normalise ~0..1
    }

    const seed = Math.random() * 99;

    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const h = pseudoNoise(gx, gy, seed);
        const m = pseudoNoise(gx * 1.6, gy * 1.6, seed + 7);

        // Terrain assignment
        let t, z;
        if (h < 0.18)             { t = T.WATER;    z = 0; }
        else if (h < 0.35)        { t = T.PLAINS;   z = 0; }
        else if (h < 0.55)        { t = m > 0.6 ? T.FOREST : T.PLAINS; z = 1; }
        else if (h < 0.72)        { t = T.HILLS;    z = 1; }
        else if (h < 0.87)        { t = T.MOUNTAIN; z = 2; }
        else                      { t = T.MOUNTAIN; z = 3; }

        // Desert patch (top-right quadrant)
        if (gx > GRID_W * 0.6 && gy < GRID_H * 0.35 && h > 0.25 && h < 0.6) {
          t = T.DESERT; z = 0;
        }
        // Snow cap on high peaks
        if (t === T.MOUNTAIN && z >= 2 && m > 0.5) t = T.SNOW;

        World.grid.push({ t, z, b: B.NONE, f: 0, u: 0, uf: 0, cd: 0 });
      }
    }

    // Place player capital (find a plains cluster near centre)
    placeCapital(0,  Math.floor(GRID_W*0.2), Math.floor(GRID_H*0.2));
    placeCapital(1,  Math.floor(GRID_W*0.75),Math.floor(GRID_H*0.2));
    placeCapital(2,  Math.floor(GRID_W*0.2), Math.floor(GRID_H*0.75));
    placeCapital(3,  Math.floor(GRID_W*0.75),Math.floor(GRID_H*0.75));
    placeCapital(4,  Math.floor(GRID_W*0.5), Math.floor(GRID_H*0.5));
  }

  function placeCapital(faction, cx, cy) {
    // Find nearest non-water tile
    for (let r = 0; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tile = World.get(cx + dx, cy + dy);
          if (tile && tile.t !== T.WATER && tile.t !== T.MOUNTAIN) {
            tile.t = T.PLAINS; tile.z = 0;
            tile.b = B.CAPITAL; tile.f = faction + 1;
            // Surrounding tiles become faction territory
            for (let sy = -1; sy <= 1; sy++) {
              for (let sx = -1; sx <= 1; sx++) {
                const s = World.get(cx + dx + sx, cy + dy + sy);
                if (s && s.t !== T.WATER) s.f = faction + 1;
              }
            }
            // Place starting unit
            tile.u = 5; tile.uf = faction + 1;
            return;
          }
        }
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     2. CAMERA & ISOMETRIC PROJECTION
  ═══════════════════════════════════════════════════════════ */

  const Camera = {
    panX: 0,
    panY: 0,
    zoom: 1.0,
    minZoom: 0.35,
    maxZoom: 2.2,

    // Convert world grid coords → screen pixel coords
    // IsoX = (gx - gy) * cos(30°) * TILE_W/2
    // IsoY = (gx + gy) * sin(30°) * TILE_H/2 - gz * Z_SCALE
    // Using 50-degree tilted camera: sin/cos tuned for that tilt
    // cos(30°)=0.866, sin(30°)=0.5 → adjusted for 50° camera tilt
    // We derive effective coefficients from the spec formula:
    //   IsoX_base = (X - Y) * cos(30°)  → multiply by TILE_W/2
    //   IsoY_base = (X + Y) * sin(30°)  → multiply by TILE_H/2
    toScreen(gx, gy, gz) {
      gz = gz || 0;
      const isoX = (gx - gy) * (TILE_W / 2) * 0.866;
      const isoY = (gx + gy) * (TILE_H / 2) * 0.5 - gz * Z_SCALE;
      const cx   = REALM.canvas.width  / 2;
      const cy   = REALM.canvas.height / 2;
      return {
        x: isoX * this.zoom + this.panX + cx,
        y: isoY * this.zoom + this.panY + cy,
      };
    },

    // Convert screen coords back to approximate grid coords (for tap detection)
    fromScreen(sx, sy) {
      const cx  = REALM.canvas.width  / 2;
      const cy  = REALM.canvas.height / 2;
      const rx  = (sx - this.panX - cx) / this.zoom;
      const ry  = (sy - this.panY - cy) / this.zoom;
      // Invert the iso transform (approximate, ignoring Z)
      const gx  = (rx / (TILE_W * 0.866 / 2) + ry / (TILE_H * 0.5 / 2)) / 2;
      const gy  = (ry / (TILE_H * 0.5 / 2) - rx / (TILE_W * 0.866 / 2)) / 2;
      return { gx: Math.round(gx), gy: Math.round(gy) };
    },

    // Is a tile visible on screen (frustum cull)
    isVisible(screenX, screenY) {
      const pad = TILE_W * Camera.zoom * 2;
      const w   = REALM.canvas.width;
      const h   = REALM.canvas.height;
      return screenX > -pad && screenX < w + pad &&
             screenY > -pad && screenY < h + pad;
    },

    centreOn(gx, gy) {
      const iso = this.toScreen(gx, gy, 0);
      const cx  = REALM.canvas.width  / 2;
      const cy  = REALM.canvas.height / 2;
      this.panX += cx - iso.x;
      this.panY += cy - iso.y;
    },
  };

  /* ═══════════════════════════════════════════════════════════
     3. RENDERING PIPELINE
  ═══════════════════════════════════════════════════════════ */

  const Renderer = {
    ctx: null,

    // Palette for terrain / buildings
    TERRAIN_TOP: [
      '#1a3a5c', // WATER
      '#6b8c3e', // PLAINS
      '#2d5c1e', // FOREST
      '#7a6040', // HILLS
      '#5a5060', // MOUNTAIN
      '#c8a84a', // DESERT
      '#c8dce8', // SNOW
    ],
    TERRAIN_LEFT: [
      '#122a44', '#4a6228', '#1e4014', '#58402c',
      '#3a3248', '#a08030', '#9ab0c0',
    ],
    TERRAIN_RIGHT: [
      '#0e2236', '#3a5020', '#162e0e', '#46301e',
      '#2c2438', '#806824', '#7898aa',
    ],

    WATER_ANIM: 0,

    init(ctx) { this.ctx = ctx; },

    // Main render call — painter's algorithm
    render() {
      const ctx = this.ctx;
      const W = REALM.canvas.width;
      const H = REALM.canvas.height;

      // Background sky gradient
      ctx.fillStyle = '#0d1b2a';
      ctx.fillRect(0, 0, W, H);

      this.WATER_ANIM = (this.WATER_ANIM + 0.02) % (Math.PI * 2);

      // Build sorted render list (back to front: low gx+gy first)
      const visible = [];
      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          const tile = World.get(gx, gy);
          const s    = Camera.toScreen(gx, gy, tile.z);
          if (Camera.isVisible(s.x, s.y)) {
            visible.push({ gx, gy, tile, sx: s.x, sy: s.y });
          }
        }
      }

      // Sort: ascending (gx+gy), tie-break by gy
      visible.sort((a, b) =>
        (a.gx + a.gy) - (b.gx + b.gy) || a.gy - b.gy
      );

      for (const item of visible) {
        this.drawTile(item.gx, item.gy, item.tile, item.sx, item.sy);
      }

      // Draw unit overlays (on top of tiles)
      for (const item of visible) {
        if (item.tile.u > 0) {
          this.drawUnit(item.tile, item.sx, item.sy);
        }
      }

      // Draw selection highlight
      if (REALM.selection.gx !== null) {
        const s = Camera.toScreen(
          REALM.selection.gx,
          REALM.selection.gy,
          World.get(REALM.selection.gx, REALM.selection.gy)?.z || 0
        );
        this.drawSelectionRing(s.x, s.y);
      }
    },

    // Draw one isometric tile (top face + left cliff + right cliff)
    drawTile(gx, gy, tile, sx, sy) {
      const ctx = this.ctx;
      const z   = this.zoom();
      const hw  = (TILE_W / 2) * z;
      const hh  = (TILE_H / 2) * z;
      const cht = tile.z * Z_SCALE * z;  // cliff total height

      const isWater = tile.t === T.WATER;

      // Animate water surface
      const waterOff = isWater ? Math.sin(this.WATER_ANIM + gx * 0.7 + gy * 0.5) * 2 : 0;

      // ── Top Face ───────────────────────────────────────────
      ctx.beginPath();
      ctx.moveTo(sx,       sy + waterOff);
      ctx.lineTo(sx + hw,  sy + hh + waterOff);
      ctx.lineTo(sx,       sy + hh * 2 + waterOff);
      ctx.lineTo(sx - hw,  sy + hh + waterOff);
      ctx.closePath();

      let topColor = this.TERRAIN_TOP[tile.t];
      if (isWater) {
        // Shimmering water gradient
        const grad = ctx.createLinearGradient(sx - hw, sy, sx + hw, sy + hh * 2);
        grad.addColorStop(0, '#1a4a6c');
        grad.addColorStop(0.4 + Math.sin(this.WATER_ANIM) * 0.1, '#1e5a80');
        grad.addColorStop(1, '#0e2a44');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = topColor;
      }
      ctx.fill();

      // Top face border
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth   = 0.5;
      ctx.stroke();

      // ── Left Cliff (only if elevated) ─────────────────────
      if (tile.z > 0 && !isWater) {
        ctx.beginPath();
        ctx.moveTo(sx - hw, sy + hh);
        ctx.lineTo(sx,      sy + hh * 2);
        ctx.lineTo(sx,      sy + hh * 2 + cht);
        ctx.lineTo(sx - hw, sy + hh + cht);
        ctx.closePath();
        ctx.fillStyle = this.TERRAIN_LEFT[tile.t];
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth   = 0.5;
        ctx.stroke();
      }

      // ── Right Cliff ────────────────────────────────────────
      if (tile.z > 0 && !isWater) {
        ctx.beginPath();
        ctx.moveTo(sx,      sy + hh * 2);
        ctx.lineTo(sx + hw, sy + hh);
        ctx.lineTo(sx + hw, sy + hh + cht);
        ctx.lineTo(sx,      sy + hh * 2 + cht);
        ctx.closePath();
        ctx.fillStyle = this.TERRAIN_RIGHT[tile.t];
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth   = 0.5;
        ctx.stroke();
      }

      // ── Faction territory tint ─────────────────────────────
      if (tile.f > 0 && !isWater) {
        ctx.beginPath();
        ctx.moveTo(sx,      sy + waterOff);
        ctx.lineTo(sx + hw, sy + hh + waterOff);
        ctx.lineTo(sx,      sy + hh * 2 + waterOff);
        ctx.lineTo(sx - hw, sy + hh + waterOff);
        ctx.closePath();
        ctx.fillStyle = this.hexToRgba(FACTION_COLORS[tile.f - 1], 0.18);
        ctx.fill();
        // Thin territory border
        ctx.strokeStyle = this.hexToRgba(FACTION_COLORS[tile.f - 1], 0.55);
        ctx.lineWidth   = 1;
        ctx.stroke();
      }

      // ── Building / Terrain Feature Sprite ─────────────────
      if (tile.b !== B.NONE) {
        this.drawBuilding(tile, sx, sy, z, cht);
      } else {
        this.drawNaturalFeature(tile, sx, sy, z);
      }
    },

    // Draw vector building on tile
    drawBuilding(tile, sx, sy, z, cht) {
      const ctx = this.ctx;
      const bx  = sx;
      const by  = sy - cht;
      const fc  = tile.f > 0 ? FACTION_COLORS[tile.f - 1] : '#aaa';

      switch (tile.b) {
        case B.CAPITAL:    this.spriteCapital(bx, by, fc, z); break;
        case B.SETTLEMENT: this.spriteSettlement(bx, by, fc, z); break;
        case B.FARM:       this.spriteFarm(bx, by, fc, z); break;
        case B.MINE:       this.spriteMine(bx, by, fc, z); break;
        case B.BARRACKS:   this.spriteBarracks(bx, by, fc, z); break;
        case B.TOWER:      this.spriteTower(bx, by, fc, z); break;
        case B.PORT:       this.spritePort(bx, by, fc, z); break;
      }
    },

    // Capital city sprite (largest)
    spriteCapital(sx, sy, fc, z) {
      const ctx = this.ctx;
      const hw = (TILE_W / 2) * z;
      const hh = (TILE_H / 2) * z;
      const cx = sx;
      const cy = sy + hh;

      // Base platform
      ctx.fillStyle = '#3a2e1c';
      this.isoRect(cx, cy - hh * 0.2, hw * 0.55, hh * 0.3, z);

      // Main keep walls
      ctx.fillStyle = '#8a7a60';
      this.isoRect(cx, cy - hh * 0.55, hw * 0.42, hh * 0.55, z);

      // Keep top (darker)
      ctx.fillStyle = '#5c4e38';
      ctx.beginPath();
      ctx.moveTo(cx,             cy - hh * 1.05);
      ctx.lineTo(cx + hw * 0.42, cy - hh * 0.55);
      ctx.lineTo(cx,             cy - hh * 0.45);
      ctx.lineTo(cx - hw * 0.42, cy - hh * 0.55);
      ctx.closePath();
      ctx.fill();

      // Left tower
      ctx.fillStyle = '#9a8a70';
      this.isoRect(cx - hw * 0.28, cy - hh * 0.65, hw * 0.16, hh * 0.65, z);
      // Right tower
      this.isoRect(cx + hw * 0.28, cy - hh * 0.65, hw * 0.16, hh * 0.65, z);

      // Tower conical tops
      ctx.fillStyle = fc;
      this.drawCone(cx - hw * 0.28, cy - hh * 0.65, hw * 0.16, hh * 0.25, z);
      this.drawCone(cx + hw * 0.28, cy - hh * 0.65, hw * 0.16, hh * 0.25, z);

      // Banner
      ctx.fillStyle = fc;
      ctx.fillRect(cx - 1, cy - hh * 1.15, 2 * z, hh * 0.28);
      ctx.beginPath();
      ctx.moveTo(cx + 1, cy - hh * 1.15);
      ctx.lineTo(cx + hw * 0.14, cy - hh * 1.05);
      ctx.lineTo(cx + 1, cy - hh * 0.95);
      ctx.closePath();
      ctx.fill();

      // Label
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(9, 10 * z)}px Courier New`;
      ctx.textAlign = 'center';
      ctx.fillText('⚑', cx, cy - hh * 1.2);
    },

    // Settlement sprite
    spriteSettlement(sx, sy, fc, z) {
      const ctx = this.ctx;
      const hw = (TILE_W / 2) * z;
      const hh = (TILE_H / 2) * z;
      const cx = sx, cy = sy + hh;

      // House base
      ctx.fillStyle = '#7a6848';
      this.isoRect(cx, cy - hh * 0.35, hw * 0.30, hh * 0.35, z);
      // Roof
      ctx.fillStyle = fc;
      ctx.beginPath();
      ctx.moveTo(cx,            cy - hh * 0.55);
      ctx.lineTo(cx + hw * 0.3, cy - hh * 0.35);
      ctx.lineTo(cx,            cy - hh * 0.25);
      ctx.lineTo(cx - hw * 0.3, cy - hh * 0.35);
      ctx.closePath();
      ctx.fill();

      // Second smaller house
      ctx.fillStyle = '#6a5838';
      this.isoRect(cx + hw * 0.28, cy - hh * 0.28, hw * 0.20, hh * 0.28, z);
      ctx.fillStyle = this.lighten(fc, 20);
      ctx.beginPath();
      ctx.moveTo(cx + hw * 0.28,  cy - hh * 0.44);
      ctx.lineTo(cx + hw * 0.48, cy - hh * 0.28);
      ctx.lineTo(cx + hw * 0.28,  cy - hh * 0.18);
      ctx.lineTo(cx + hw * 0.08, cy - hh * 0.28);
      ctx.closePath();
      ctx.fill();
    },

    // Farm sprite
    spriteFarm(sx, sy, fc, z) {
      const ctx = this.ctx;
      const hw = (TILE_W / 2) * z;
      const hh = (TILE_H / 2) * z;
      const cx = sx, cy = sy + hh;

      // Field rows
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = i % 2 === 0 ? '#8b7a2a' : '#6b9a30';
        ctx.lineWidth   = 2 * z;
        ctx.beginPath();
        const off = (i - 1) * hh * 0.28;
        ctx.moveTo(cx - hw * 0.5, cy + off);
        ctx.lineTo(cx + hw * 0.5, cy + off);
        ctx.stroke();
      }
      // Barn
      ctx.fillStyle = '#8b3a1a';
      this.isoRect(cx - hw * 0.2, cy - hh * 0.45, hw * 0.25, hh * 0.45, z);
      ctx.fillStyle = '#5a2810';
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.2,  cy - hh * 0.65);
      ctx.lineTo(cx + hw * 0.05, cy - hh * 0.45);
      ctx.lineTo(cx - hw * 0.2,  cy - hh * 0.35);
      ctx.lineTo(cx - hw * 0.45, cy - hh * 0.45);
      ctx.closePath();
      ctx.fill();
    },

    // Mine sprite
    spriteMine(sx, sy, fc, z) {
      const ctx = this.ctx;
      const hw = (TILE_W / 2) * z;
      const hh = (TILE_H / 2) * z;
      const cx = sx, cy = sy + hh;

      // Mine entrance archway
      ctx.fillStyle = '#3a3030';
      ctx.beginPath();
      ctx.arc(cx, cy - hh * 0.2, hw * 0.22, Math.PI, 0);
      ctx.lineTo(cx + hw * 0.22, cy - hh * 0.2);
      ctx.lineTo(cx - hw * 0.22, cy - hh * 0.2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#1a1010';
      ctx.beginPath();
      ctx.arc(cx, cy - hh * 0.22, hw * 0.15, Math.PI, 0);
      ctx.fill();

      // Support beams
      ctx.strokeStyle = '#8b6a30';
      ctx.lineWidth   = 3 * z;
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.2, cy); ctx.lineTo(cx - hw * 0.2, cy - hh * 0.45);
      ctx.moveTo(cx + hw * 0.2, cy); ctx.lineTo(cx + hw * 0.2, cy - hh * 0.45);
      ctx.moveTo(cx - hw * 0.2, cy - hh * 0.4); ctx.lineTo(cx + hw * 0.2, cy - hh * 0.4);
      ctx.stroke();

      // Ore sparkle
      ctx.fillStyle = '#f5c842';
      ctx.font = `${Math.max(8, 10 * z)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('⛏', cx, cy - hh * 0.5);
    },

    // Barracks sprite
    spriteBarracks(sx, sy, fc, z) {
      const ctx = this.ctx;
      const hw = (TILE_W / 2) * z;
      const hh = (TILE_H / 2) * z;
      const cx = sx, cy = sy + hh;

      // Barracks building
      ctx.fillStyle = '#4a3a28';
      this.isoRect(cx, cy - hh * 0.4, hw * 0.45, hh * 0.4, z);
      // Crenelated top
      ctx.fillStyle = '#5a4a38';
      const battH = hh * 0.12;
      const battW = hw * 0.14;
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(cx + i * battW * 1.5 - battW / 2, cy - hh * 0.4 - battH, battW, battH);
      }
      // Door
      ctx.fillStyle = '#2a1c0e';
      ctx.fillRect(cx - battW * 0.4, cy - hh * 0.22, battW * 0.8, hh * 0.22);
      // Faction pennant
      ctx.fillStyle = fc;
      ctx.fillRect(cx - 1, cy - hh * 0.55, 1.5, hh * 0.12);
    },

    // Watch tower sprite
    spriteTower(sx, sy, fc, z) {
      const ctx = this.ctx;
      const hw = (TILE_W / 2) * z;
      const hh = (TILE_H / 2) * z;
      const cx = sx, cy = sy + hh;

      // Tower shaft
      ctx.fillStyle = '#7a7070';
      this.isoRect(cx, cy - hh * 0.85, hw * 0.22, hh * 0.85, z);
      // Top crenelations
      ctx.fillStyle = '#9a9088';
      this.isoRect(cx, cy - hh * 1.05, hw * 0.28, hh * 0.22, z);
      // Battlements
      ctx.fillStyle = '#7a7070';
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(cx + i * hw * 0.2 - hw * 0.06, cy - hh * 1.12, hw * 0.1, hh * 0.12);
      }
      // Flag
      ctx.fillStyle = fc;
      ctx.fillRect(cx, cy - hh * 1.22, 2 * z, hh * 0.18);
      ctx.beginPath();
      ctx.moveTo(cx + 2 * z, cy - hh * 1.22);
      ctx.lineTo(cx + hw * 0.16, cy - hh * 1.14);
      ctx.lineTo(cx + 2 * z,     cy - hh * 1.06);
      ctx.closePath();
      ctx.fill();
    },

    // Port sprite
    spritePort(sx, sy, fc, z) {
      const ctx = this.ctx;
      const hw = (TILE_W / 2) * z;
      const hh = (TILE_H / 2) * z;
      const cx = sx, cy = sy + hh;

      // Dock planks
      ctx.fillStyle = '#6a4a28';
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(cx + i * hw * 0.15 - 2, cy - hh * 0.05, 4, hh * 0.22);
      }
      // Boat hull
      ctx.fillStyle = '#8b5a20';
      ctx.beginPath();
      ctx.ellipse(cx, cy - hh * 0.2, hw * 0.35, hh * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      // Sail
      ctx.fillStyle = '#e8d5a3';
      ctx.beginPath();
      ctx.moveTo(cx, cy - hh * 0.55);
      ctx.lineTo(cx + hw * 0.22, cy - hh * 0.3);
      ctx.lineTo(cx, cy - hh * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8b6030';
      ctx.lineWidth   = 1.5 * z;
      ctx.beginPath();
      ctx.moveTo(cx, cy - hh * 0.6);
      ctx.lineTo(cx, cy - hh * 0.15);
      ctx.stroke();
    },

    // Natural terrain decoration
    drawNaturalFeature(tile, sx, sy, z) {
      const ctx = this.ctx;
      const hw = (TILE_W / 2) * z;
      const hh = (TILE_H / 2) * z;
      const cx = sx, cy = sy + hh;

      switch (tile.t) {
        case T.FOREST:
          // Pine trees
          for (let t = 0; t < 2; t++) {
            const ox = (t === 0 ? -hw * 0.2 : hw * 0.15);
            const sc = t === 0 ? 1 : 0.8;
            ctx.fillStyle = '#1a4010';
            ctx.beginPath();
            ctx.moveTo(cx + ox, cy - hh * (0.7 * sc));
            ctx.lineTo(cx + ox + hw * 0.16 * sc, cy - hh * 0.1);
            ctx.lineTo(cx + ox - hw * 0.16 * sc, cy - hh * 0.1);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#2a5a1e';
            ctx.beginPath();
            ctx.moveTo(cx + ox, cy - hh * (0.9 * sc));
            ctx.lineTo(cx + ox + hw * 0.12 * sc, cy - hh * (0.3 * sc));
            ctx.lineTo(cx + ox - hw * 0.12 * sc, cy - hh * (0.3 * sc));
            ctx.closePath();
            ctx.fill();
          }
          break;

        case T.MOUNTAIN:
        case T.SNOW: {
          ctx.fillStyle = tile.t === T.SNOW ? '#c8dce8' : '#7a7080';
          ctx.beginPath();
          ctx.moveTo(cx, cy - hh * 0.9);
          ctx.lineTo(cx + hw * 0.35, cy - hh * 0.15);
          ctx.lineTo(cx - hw * 0.35, cy - hh * 0.15);
          ctx.closePath();
          ctx.fill();
          if (tile.t === T.MOUNTAIN) {
            ctx.fillStyle = '#c8dce8';
            ctx.beginPath();
            ctx.moveTo(cx, cy - hh * 0.9);
            ctx.lineTo(cx + hw * 0.12, cy - hh * 0.55);
            ctx.lineTo(cx - hw * 0.12, cy - hh * 0.55);
            ctx.closePath();
            ctx.fill();
          }
          break;
        }

        case T.HILLS: {
          ctx.fillStyle = '#8a7050';
          ctx.beginPath();
          ctx.ellipse(cx, cy - hh * 0.25, hw * 0.4, hh * 0.3, 0, Math.PI, 0);
          ctx.fill();
          break;
        }

        case T.DESERT: {
          // Cactus
          ctx.strokeStyle = '#6a8a20';
          ctx.lineWidth   = 3 * z;
          ctx.beginPath();
          ctx.moveTo(cx, cy - hh * 0.05);
          ctx.lineTo(cx, cy - hh * 0.55);
          ctx.moveTo(cx, cy - hh * 0.38);
          ctx.lineTo(cx + hw * 0.2, cy - hh * 0.38);
          ctx.lineTo(cx + hw * 0.2, cy - hh * 0.5);
          ctx.stroke();
          break;
        }
      }
    },

    // Unit marker
    drawUnit(tile, sx, sy) {
      const ctx = this.ctx;
      const z   = this.zoom();
      const hw  = (TILE_W / 2) * z;
      const hh  = (TILE_H / 2) * z;
      const cx  = sx, cy = sy + hh * 0.5;
      const fc  = tile.uf > 0 ? FACTION_COLORS[tile.uf - 1] : '#aaa';
      const r   = 10 * z;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = fc;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Strength number
      ctx.fillStyle = '#fff';
      ctx.font      = `bold ${Math.max(8, 9 * z)}px Courier New`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tile.u, cx, cy);
      ctx.textBaseline = 'alphabetic';
    },

    // Selection pulsing ring
    drawSelectionRing(sx, sy) {
      const ctx = this.ctx;
      const z   = this.zoom();
      const hw  = (TILE_W / 2) * z;
      const hh  = (TILE_H / 2) * z;
      const t   = performance.now() * 0.003;
      const alpha = 0.5 + Math.sin(t) * 0.35;

      ctx.beginPath();
      ctx.moveTo(sx,       sy);
      ctx.lineTo(sx + hw,  sy + hh);
      ctx.lineTo(sx,       sy + hh * 2);
      ctx.lineTo(sx - hw,  sy + hh);
      ctx.closePath();
      ctx.strokeStyle = `rgba(245,200,66,${alpha})`;
      ctx.lineWidth   = 2.5;
      ctx.stroke();
    },

    // Helper: draw a simplified isometric rectangle (for building volumes)
    isoRect(cx, cy, hw, height, z) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy);
      ctx.lineTo(cx,      cy - (TILE_H / 2) * z * 0.5);
      ctx.lineTo(cx + hw, cy);
      ctx.lineTo(cx,      cy + (TILE_H / 2) * z * 0.5);
      ctx.closePath();
      const old = ctx.fillStyle;
      ctx.fill();
      // Front face
      ctx.beginPath();
      ctx.moveTo(cx,       cy + (TILE_H / 2) * z * 0.5);
      ctx.lineTo(cx + hw,  cy);
      ctx.lineTo(cx + hw,  cy - height);
      ctx.lineTo(cx,       cy + (TILE_H / 2) * z * 0.5 - height);
      ctx.closePath();
      ctx.fillStyle = this.darken(old, 20);
      ctx.fill();
      // Left face
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy);
      ctx.lineTo(cx,      cy + (TILE_H / 2) * z * 0.5);
      ctx.lineTo(cx,      cy + (TILE_H / 2) * z * 0.5 - height);
      ctx.lineTo(cx - hw, cy - height);
      ctx.closePath();
      ctx.fillStyle = this.darken(old, 35);
      ctx.fill();
      ctx.fillStyle = old;
    },

    drawCone(cx, cy, hw, h, z) {
      const ctx = this.ctx;
      const old = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h);
      ctx.lineTo(cx + hw, cy);
      ctx.lineTo(cx - hw, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = old;
    },

    zoom() { return Camera.zoom; },

    // Colour utilities
    hexToRgba(hex, a) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    },
    darken(hex, pct) {
      try {
        const n = parseInt(hex.replace('#',''), 16);
        const f = 1 - pct / 100;
        const r = Math.max(0, Math.floor(((n >> 16) & 0xff) * f));
        const g = Math.max(0, Math.floor(((n >> 8)  & 0xff) * f));
        const b = Math.max(0, Math.floor(( n        & 0xff) * f));
        return `rgb(${r},${g},${b})`;
      } catch { return hex; }
    },
    lighten(hex, pct) {
      try {
        const n = parseInt(hex.replace('#',''), 16);
        const f = 1 + pct / 100;
        const r = Math.min(255, Math.floor(((n >> 16) & 0xff) * f));
        const g = Math.min(255, Math.floor(((n >> 8)  & 0xff) * f));
        const b = Math.min(255, Math.floor(( n        & 0xff) * f));
        return `rgb(${r},${g},${b})`;
      } catch { return hex; }
    },
  };

  /* ═══════════════════════════════════════════════════════════
     4. AI HEURISTIC ENGINE
  ═══════════════════════════════════════════════════════════ */

  const AI = {

    // Run one full turn for an AI faction
    processFaction(faction) {
      // faction is 1-indexed (1..AI_COUNT)
      const res = World.resources[faction];

      // Collect adjacent tile data for all owned tiles
      const owned = [];
      const border = new Map(); // key="gx,gy" → tile (unowned neighbours)

      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          const tile = World.get(gx, gy);
          if (!tile) continue;
          if (tile.f === faction) {
            owned.push({ gx, gy, tile });
            // Check 4 neighbours for borders
            const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
            for (const [dx, dy] of dirs) {
              const nx = gx + dx, ny = gy + dy;
              const nb = World.get(nx, ny);
              if (nb && nb.f !== faction && nb.t !== T.WATER) {
                border.set(`${nx},${ny}`, { gx: nx, gy: ny, tile: nb });
              }
            }
          }
        }
      }

      if (owned.length === 0) return;

      // ── 1. Expand (claim unclaimed border tiles) ─────────
      for (const [, b] of border) {
        if (b.tile.f === 0) {
          // Unclaimed — always expand for free
          World.set(b.gx, b.gy, { f: faction });
          break; // one expansion per turn
        }
      }

      // ── 2. Build (heuristic priority) ────────────────────
      const needsFarm  = res.food < 40;
      const needsMine  = res.prod < 30;
      const needsBrks  = res.prod > 50 && owned.length > 5;
      const canAfford  = (g, p) => res.gold >= g && res.prod >= p;

      let built = false;
      for (const { gx, gy, tile } of owned) {
        if (built) break;
        if (tile.b !== B.NONE || tile.t === T.WATER) continue;

        if (needsFarm && tile.t === T.PLAINS && canAfford(20, 5)) {
          World.set(gx, gy, { b: B.FARM, cd: 1 });
          res.gold -= 20; res.prod -= 5; built = true;
        } else if (needsMine && tile.t === T.HILLS && canAfford(30, 10)) {
          World.set(gx, gy, { b: B.MINE, cd: 1 });
          res.gold -= 30; res.prod -= 10; built = true;
        } else if (needsBrks && canAfford(40, 15)) {
          World.set(gx, gy, { b: B.BARRACKS, cd: 1 });
          res.gold -= 40; res.prod -= 15; built = true;
        } else if (!built && owned.length < 4 && canAfford(15, 5)) {
          World.set(gx, gy, { b: B.SETTLEMENT, cd: 1 });
          res.gold -= 15; res.prod -= 5; built = true;
        }
      }

      // ── 3. Train units (if barracks present) ─────────────
      for (const { gx, gy, tile } of owned) {
        if (tile.b === B.BARRACKS && tile.u < 8 && canAfford(20, 10)) {
          World.set(gx, gy, { u: tile.u + 2, uf: faction });
          res.gold -= 20; res.prod -= 10;
          break;
        }
      }

      // ── 4. Attack adjacent enemy tiles ───────────────────
      for (const { gx, gy, tile } of owned) {
        if (tile.u <= 0) continue;
        const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
        for (const [dx, dy] of dirs) {
          const nx = gx + dx, ny = gy + dy;
          const nb = World.get(nx, ny);
          if (nb && nb.f > 0 && nb.f !== faction) {
            Combat.resolve(gx, gy, nx, ny);
            break;
          }
        }
      }
    },
  };

  /* ═══════════════════════════════════════════════════════════
     5. COMBAT SYSTEM
  ═══════════════════════════════════════════════════════════ */

  const Combat = {
    log: [],

    // Resolve attack from (ax,ay) → (dx,dy)
    resolve(ax, ay, dx, dy) {
      const attacker = World.get(ax, ay);
      const defender = World.get(dx, dy);
      if (!attacker || !defender) return;
      if (attacker.u <= 0) return;

      // Combat modifiers
      const terrainBonus = [0, 0, 1, 2, 3, 0, 1]; // defence by terrain
      const buildBonus   = [0, 1, 0, 0, 2, 3, 2, 1]; // defence by building

      const atkStr = attacker.u;
      const defStr = defender.u + terrainBonus[defender.t] + buildBonus[defender.b];

      // Dice rolls (deterministic weighted random)
      const atkRoll = atkStr * (0.6 + Math.random() * 0.8);
      const defRoll = defStr * (0.5 + Math.random() * 0.7);

      const atkLoss = Math.ceil(defRoll * 0.3);
      const defLoss = Math.ceil(atkRoll * 0.4);

      const newAtkU = Math.max(0, attacker.u - atkLoss);
      const newDefU = Math.max(0, defender.u - defLoss);

      World.set(ax, ay, { u: newAtkU });

      const atkFaction = attacker.uf || attacker.f;
      const defFaction = defender.uf || defender.f;

      const line = (msg, cls) => this.log.push({ msg, cls });

      if (newDefU <= 0) {
        // Attacker conquers tile
        const moveStr = Math.max(1, Math.floor(newAtkU / 2));
        World.set(dx, dy, { f: atkFaction, u: moveStr, uf: atkFaction, b: defender.b });
        World.set(ax, ay, { u: Math.max(0, newAtkU - moveStr) });
        line(
          `${FACTION_NAMES[atkFaction-1]} conquered tile (${dx},${dy}) from ${FACTION_NAMES[defFaction-1]}`,
          'victory'
        );
      } else {
        World.set(dx, dy, { u: newDefU });
        line(
          `${FACTION_NAMES[atkFaction-1]} attacked ${FACTION_NAMES[defFaction-1]}: `+
          `Atk lost ${atkLoss}, Def lost ${defLoss}`,
          'neutral'
        );
      }
    },

    showLog() {
      if (this.log.length === 0) return;
      const body = document.getElementById('combat-log-body');
      const el   = document.getElementById('combat-log');
      body.innerHTML = this.log
        .map(l => `<div class="combat-log-line ${l.cls}">${l.msg}</div>`)
        .join('');
      el.classList.remove('hidden');
      this.log = [];
    },
  };

  /* ═══════════════════════════════════════════════════════════
     6. BUILDING DEFINITIONS
  ═══════════════════════════════════════════════════════════ */

  const BUILDINGS = [
    { id: B.SETTLEMENT, name: 'Settlement',  goldCost: 15, prodCost: 5,
      validOn: [T.PLAINS, T.DESERT],
      desc: '+2 Gold, +1 Food per turn', canBuild: true },
    { id: B.FARM,       name: 'Farm',        goldCost: 20, prodCost: 5,
      validOn: [T.PLAINS],
      desc: '+4 Food per turn', canBuild: true },
    { id: B.MINE,       name: 'Mine',        goldCost: 30, prodCost: 10,
      validOn: [T.HILLS, T.MOUNTAIN],
      desc: '+3 Production per turn', canBuild: true },
    { id: B.BARRACKS,   name: 'Barracks',    goldCost: 40, prodCost: 15,
      validOn: [T.PLAINS, T.HILLS],
      desc: 'Train units', canBuild: true },
    { id: B.TOWER,      name: 'Watch Tower', goldCost: 35, prodCost: 12,
      validOn: [T.HILLS, T.PLAINS, T.MOUNTAIN],
      desc: '+3 Defence on tile', canBuild: true },
    { id: B.PORT,       name: 'Port',        goldCost: 45, prodCost: 15,
      validOn: [T.PLAINS],
      desc: '+3 Gold, +1 Prod per turn', canBuild: true },
  ];

  /* ═══════════════════════════════════════════════════════════
     7. HUD & DOM MANAGEMENT
  ═══════════════════════════════════════════════════════════ */

  const HUD = {
    gold:     null,
    food:     null,
    prod:     null,
    turn:     null,
    level:    null,
    fill:     null,
    eraLabel: null,
    toast:    null,
    toastTimer: null,

    init() {
      this.gold     = document.getElementById('val-gold');
      this.food     = document.getElementById('val-food');
      this.prod     = document.getElementById('val-prod');
      this.turn     = document.getElementById('val-turn');
      this.level    = document.getElementById('val-level');
      this.fill     = document.getElementById('progress-fill');
      this.eraLabel = document.getElementById('hud-era-label');
      this.toast    = document.getElementById('toast');
    },

    update() {
      const r = World.resources[0];
      this.gold.textContent = r.gold;
      this.food.textContent = r.food;
      this.prod.textContent = r.prod;
      this.turn.textContent = World.turn;
      this.level.textContent = World.level;

      // Era label
      this.eraLabel.textContent = World.ERA_NAMES[World.era] || 'Age of Iron';

      // Progress fill: % toward next era
      const curThresh  = World.ERA_THRESHOLDS[World.era]       || 0;
      const nextThresh = World.ERA_THRESHOLDS[World.era + 1]   || 100;
      let ownedTiles   = 0;
      for (let i = 0; i < World.grid.length; i++) {
        if (World.grid[i].f === 1) ownedTiles++;
      }
      const pct = Math.min(100, ((ownedTiles - curThresh) / (nextThresh - curThresh)) * 100);
      this.fill.style.width = `${Math.max(0, pct)}%`;

      // Level up? (every 10 turns)
      const newLevel = Math.floor(World.turn / 10) + 1;
      if (newLevel !== World.level) {
        World.level = newLevel;
        this.notify(`⚡ Advanced to Level ${World.level}!`);
      }
    },

    notify(msg, duration) {
      duration = duration || 2400;
      this.toast.textContent = msg;
      this.toast.classList.remove('hidden');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toast.classList.add('hidden');
      }, duration);
    },

    updateBuildMenu(selectedTile) {
      const list = document.getElementById('build-list');
      list.innerHTML = '';
      if (!selectedTile) {
        list.innerHTML = '<div style="color:#888;font-size:12px;text-align:center">Select a tile first</div>';
        return;
      }
      const res = World.resources[0];
      for (const bld of BUILDINGS) {
        if (!bld.validOn.includes(selectedTile.t)) continue;
        if (selectedTile.b !== B.NONE) continue;

        const canAfford = res.gold >= bld.goldCost && res.prod >= bld.prodCost;
        const row = document.createElement('div');
        row.className = 'build-item' + (canAfford ? '' : ' build-item-disabled');
        row.innerHTML = `
          <div>
            <div class="build-item-name">${bld.name}</div>
            <div class="build-item-cost">⚜${bld.goldCost} ⚒${bld.prodCost} — ${bld.desc}</div>
          </div>
        `;
        if (canAfford) {
          row.onclick = () => {
            REALM.buildAt(REALM.selection.gx, REALM.selection.gy, bld.id);
            REALM.closeBuildMenu();
          };
        }
        list.appendChild(row);
      }
      if (list.children.length === 0) {
        list.innerHTML = '<div style="color:#888;font-size:12px;text-align:center">No valid buildings for this tile</div>';
      }
    },
  };

  /* ═══════════════════════════════════════════════════════════
     8. INPUT HANDLING (Touch & Mouse)
  ═══════════════════════════════════════════════════════════ */

  const Input = {
    dragging:    false,
    lastX:       0,
    lastY:       0,
    pinching:    false,
    pinchDist:   0,
    tapStart:    null,
    TAP_THRESH:  12,   // px
    TAP_TIME:    250,  // ms

    init(canvas) {
      // Touch events (iPad primary input)
      canvas.addEventListener('touchstart',  this.onTouchStart.bind(this),  { passive: false });
      canvas.addEventListener('touchmove',   this.onTouchMove.bind(this),   { passive: false });
      canvas.addEventListener('touchend',    this.onTouchEnd.bind(this),    { passive: false });
      canvas.addEventListener('touchcancel', this.onTouchEnd.bind(this),    { passive: false });

      // Mouse fallback (desktop testing)
      canvas.addEventListener('mousedown',   this.onMouseDown.bind(this));
      canvas.addEventListener('mousemove',   this.onMouseMove.bind(this));
      canvas.addEventListener('mouseup',     this.onMouseUp.bind(this));
      canvas.addEventListener('wheel',       this.onWheel.bind(this), { passive: false });
    },

    pinchDistance(t) {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    },

    onTouchStart(e) {
      e.preventDefault();
      if (e.touches.length === 2) {
        this.pinching  = true;
        this.dragging  = false;
        this.pinchDist = this.pinchDistance(e.touches);
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.dragging  = true;
        this.pinching  = false;
        this.lastX     = t.clientX;
        this.lastY     = t.clientY;
        this.tapStart  = { x: t.clientX, y: t.clientY, time: Date.now() };
      }
    },

    onTouchMove(e) {
      e.preventDefault();
      if (this.pinching && e.touches.length === 2) {
        const dist  = this.pinchDistance(e.touches);
        const scale = dist / this.pinchDist;
        this.pinchDist = dist;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        this.applyZoom(scale, midX, midY);
        return;
      }
      if (this.dragging && e.touches.length === 1) {
        const t  = e.touches[0];
        const dx = t.clientX - this.lastX;
        const dy = t.clientY - this.lastY;
        Camera.panX += dx;
        Camera.panY += dy;
        this.lastX   = t.clientX;
        this.lastY   = t.clientY;
        // If moved significantly, it's a drag not a tap
        if (this.tapStart) {
          const dd = Math.hypot(t.clientX - this.tapStart.x, t.clientY - this.tapStart.y);
          if (dd > this.TAP_THRESH) this.tapStart = null;
        }
      }
    },

    onTouchEnd(e) {
      e.preventDefault();
      this.pinching = false;
      if (e.touches.length === 0) {
        this.dragging = false;
        // Tap detection
        if (this.tapStart && Date.now() - this.tapStart.time < this.TAP_TIME) {
          REALM.onTap(this.tapStart.x, this.tapStart.y);
        }
        this.tapStart = null;
      }
    },

    onMouseDown(e) {
      this.dragging = true;
      this.lastX    = e.clientX;
      this.lastY    = e.clientY;
      this.tapStart = { x: e.clientX, y: e.clientY, time: Date.now() };
    },

    onMouseMove(e) {
      if (!this.dragging) return;
      Camera.panX += e.clientX - this.lastX;
      Camera.panY += e.clientY - this.lastY;
      this.lastX   = e.clientX;
      this.lastY   = e.clientY;
      if (this.tapStart) {
        const dd = Math.hypot(e.clientX - this.tapStart.x, e.clientY - this.tapStart.y);
        if (dd > this.TAP_THRESH) this.tapStart = null;
      }
    },

    onMouseUp(e) {
      this.dragging = false;
      if (this.tapStart && Date.now() - this.tapStart.time < this.TAP_TIME) {
        REALM.onTap(this.tapStart.x, this.tapStart.y);
      }
      this.tapStart = null;
    },

    onWheel(e) {
      e.preventDefault();
      const scale = e.deltaY < 0 ? 1.1 : 0.9;
      this.applyZoom(scale, e.clientX, e.clientY);
    },

    // Zoom relative to a focal point on screen
    applyZoom(scale, focalX, focalY) {
      const oldZoom = Camera.zoom;
      Camera.zoom   = Math.max(Camera.minZoom, Math.min(Camera.maxZoom, Camera.zoom * scale));
      const ratio   = Camera.zoom / oldZoom - 1;
      const cx      = REALM.canvas.width  / 2;
      const cy      = REALM.canvas.height / 2;
      Camera.panX  -= (focalX - cx - Camera.panX) * ratio;
      Camera.panY  -= (focalY - cy - Camera.panY) * ratio;
    },
  };

  /* ═══════════════════════════════════════════════════════════
     8a. CAMERA CONTROLS (D-pad / Zoom / Reset buttons)
  ═══════════════════════════════════════════════════════════ */

  const CameraControls = {
    // How many pixels to pan per step (scaled by zoom so it feels consistent)
    PAN_STEP: 80,
    // Repeat interval when button is held (ms)
    REPEAT_MS: 80,
    _held: null,   // { intervalId }

    init() {
      const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (!el) return;
        // Tap / click
        el.addEventListener('click', fn);
        // Hold-to-repeat for dpad
        if (id.startsWith('dpad')) {
          el.addEventListener('touchstart',  (e) => { e.preventDefault(); this._startHold(fn); }, { passive: false });
          el.addEventListener('touchend',    (e) => { e.preventDefault(); this._stopHold(); },  { passive: false });
          el.addEventListener('touchcancel', (e) => { e.preventDefault(); this._stopHold(); },  { passive: false });
          el.addEventListener('mousedown',   () => this._startHold(fn));
          el.addEventListener('mouseup',     () => this._stopHold());
          el.addEventListener('mouseleave',  () => this._stopHold());
        }
      };

      bind('dpad-up',    () => this.pan( 0,  1));
      bind('dpad-down',  () => this.pan( 0, -1));
      bind('dpad-left',  () => this.pan( 1,  0));
      bind('dpad-right', () => this.pan(-1,  0));

      document.getElementById('btn-zoom-in') ?.addEventListener('click', () => this.zoom(1.2));
      document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.zoom(0.8));
      document.getElementById('btn-reset-cam')?.addEventListener('click', () => this.reset());
    },

    pan(dx, dy) {
      const step = this.PAN_STEP;
      Camera.panX += dx * step;
      Camera.panY += dy * step;
    },

    zoom(factor) {
      const cx = REALM.canvas.width  / 2;
      const cy = REALM.canvas.height / 2;
      const oldZoom = Camera.zoom;
      Camera.zoom   = Math.max(Camera.minZoom, Math.min(Camera.maxZoom, Camera.zoom * factor));
      const ratio   = Camera.zoom / oldZoom - 1;
      Camera.panX  -= (cx - Camera.panX) * ratio;  // zoom toward screen centre
      Camera.panY  -= (cy - Camera.panY) * ratio;
    },

    reset() {
      // Re-centre on player capital, zoom to default
      Camera.zoom = 1.0;
      Camera.panX = 0;
      Camera.panY = 0;
      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          const t = World.get(gx, gy);
          if (t && t.f === 1 && t.b === B.CAPITAL) {
            Camera.centreOn(gx, gy);
            HUD.notify('⌖ Camera reset');
            return;
          }
        }
      }
      HUD.notify('⌖ Camera reset');
    },

    _startHold(fn) {
      this._stopHold();
      fn();   // fire immediately
      this._held = setInterval(fn, this.REPEAT_MS);
    },

    _stopHold() {
      if (this._held) { clearInterval(this._held); this._held = null; }
    },
  };



  const Save = {
    KEY: 'realm_save',

    save() {
      const json = World.serialise();
      try {
        localStorage.setItem(this.KEY, json);
        // Expose for Apple Shortcuts to read back
        window.REALM_LAST_SAVE = json;
        HUD.notify('💾 Game saved');
        return json;
      } catch (e) {
        HUD.notify('Save failed (storage full?)');
        return null;
      }
    },

    load(json) {
      if (!json) {
        json = localStorage.getItem(this.KEY);
      }
      if (!json) return false;
      const ok = World.deserialise(json);
      if (ok) {
        HUD.notify('📂 Save loaded');
        HUD.update();
      }
      return ok;
    },
  };

  /* ═══════════════════════════════════════════════════════════
     10. MAIN GAME LOOP & PUBLIC API
  ═══════════════════════════════════════════════════════════ */

  let lastTime = 0;
  let frameId  = null;

  function loop(ts) {
    frameId = requestAnimationFrame(loop);
    if (ts - lastTime < 1000 / FPS_CAP) return;
    lastTime = ts;
    Renderer.render();
  }

  /* Public namespace — referenced by HTML and Apple Shortcuts */
  const REALM = {
    canvas:    null,
    selection: { gx: null, gy: null },
    menuOpen:  false,
    buildOpen: false,

    /** Called automatically on DOMContentLoaded */
    init() {
      this.canvas = document.getElementById('realm-canvas');
      this.resizeCanvas();

      const ctx = this.canvas.getContext('2d');
      Renderer.init(ctx);
      HUD.init();
      Input.init(this.canvas);
      CameraControls.init();

      // Window resize
      window.addEventListener('resize', () => this.resizeCanvas());

      // Load save or generate new world
      const injected = window.SHORTCUTS_SAVE || null;
      if (!Save.load(injected)) {
        generateWorld();
        HUD.notify('👑 New realm forged — lead your people to glory!', 3500);
      }

      World.checkEra();
      HUD.update();

      // Centre camera on player capital
      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          const t = World.get(gx, gy);
          if (t && t.f === 1 && t.b === B.CAPITAL) {
            Camera.centreOn(gx, gy);
          }
        }
      }

      // Start render loop
      frameId = requestAnimationFrame(loop);
    },

    resizeCanvas() {
      if (!this.canvas) return;
      this.canvas.width  = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    // Tap handler: select a tile
    onTap(screenX, screenY) {
      const { gx, gy } = Camera.fromScreen(screenX, screenY);
      const tile = World.get(gx, gy);
      if (!tile) return;

      this.selection = { gx, gy };
      this.showTileInfo(gx, gy, tile);
    },

    showTileInfo(gx, gy, tile) {
      const terrainNames = ['Water','Plains','Forest','Hills','Mountain','Desert','Snow'];
      const buildNames   = ['—','Settlement','Farm','Mine','Barracks','Watch Tower','Capital','Port'];
      const fName = tile.f > 0 ? FACTION_NAMES[tile.f - 1] : 'Unclaimed';
      const bName = buildNames[tile.b] || '—';
      const y     = World.yieldFor(tile);

      document.getElementById('tile-info-name').textContent =
        `${terrainNames[tile.t]} (${gx}, ${gy})`;
      document.getElementById('tile-info-stats').innerHTML =
        `Owner: ${fName}<br>` +
        `Building: ${bName}<br>` +
        `Elevation: ${tile.z}<br>` +
        `Yield: ⚜${y.gold} 🌾${y.food} ⚒${y.prod}` +
        (tile.u > 0 ? `<br>Units: ${tile.u} (${FACTION_NAMES[tile.uf-1]||'?'})` : '');

      document.getElementById('tile-info').classList.remove('hidden');
    },

    // Player ends their turn
    endTurn() {
      // Close menus
      this.closeBuildMenu();
      document.getElementById('tile-info').classList.add('hidden');

      // Collect player resources
      World.collectResources(1);

      // Tick cooldowns
      for (const tile of World.grid) {
        if (tile.cd > 0) tile.cd--;
      }

      // AI factions take their turns
      for (let f = 2; f <= AI_COUNT + 1; f++) {
        World.collectResources(f);
        AI.processFaction(f);
      }

      World.turn++;
      World.checkEra();
      HUD.update();

      Combat.showLog();
      HUD.notify(`⏳ Turn ${World.turn}`);
    },

    // Place a building at the selected tile
    buildAt(gx, gy, buildingId) {
      const tile = World.get(gx, gy);
      if (!tile) { HUD.notify('Invalid tile'); return; }
      if (tile.f !== 1) { HUD.notify('You don\'t own this tile'); return; }
      if (tile.b !== B.NONE) { HUD.notify('Tile already has a building'); return; }

      const bld = BUILDINGS.find(b => b.id === buildingId);
      if (!bld) return;

      const res = World.resources[0];
      if (res.gold < bld.goldCost) { HUD.notify(`Need ${bld.goldCost} Gold`); return; }
      if (res.prod < bld.prodCost) { HUD.notify(`Need ${bld.prodCost} Production`); return; }
      if (!bld.validOn.includes(tile.t)) { HUD.notify('Cannot build here'); return; }

      res.gold -= bld.goldCost;
      res.prod -= bld.prodCost;
      World.set(gx, gy, { b: buildingId, cd: 1 });
      HUD.update();
      HUD.notify(`🏗 ${bld.name} constructed`);
    },

    openBuildMenu() {
      const sel = this.selection;
      const tile = sel.gx !== null ? World.get(sel.gx, sel.gy) : null;
      HUD.updateBuildMenu(tile);
      document.getElementById('build-menu').classList.remove('hidden');
      this.buildOpen = true;
    },

    closeBuildMenu() {
      document.getElementById('build-menu').classList.add('hidden');
      this.buildOpen = false;
    },

    toggleMenu() {
      const el = document.getElementById('game-menu');
      this.menuOpen = !this.menuOpen;
      el.classList.toggle('hidden', !this.menuOpen);
    },

    saveGame() {
      return Save.save();
    },

    /** Load a JSON string (called by Apple Shortcuts or programmatically) */
    loadSave(json) {
      if (Save.load(json)) {
        World.checkEra();
        HUD.update();
        // Re-centre on capital
        for (let gy = 0; gy < GRID_H; gy++) {
          for (let gx = 0; gx < GRID_W; gx++) {
            const t = World.get(gx, gy);
            if (t && t.f === 1 && t.b === B.CAPITAL) {
              Camera.centreOn(gx, gy);
              return true;
            }
          }
        }
        return true;
      }
      return false;
    },

    newGame() {
      World.turn = 1;
      World.level = 1;
      World.era   = 0;
      World.resources = [
        { gold: 50, food: 30, prod: 20 },
        { gold: 40, food: 25, prod: 15 },
        { gold: 40, food: 25, prod: 15 },
        { gold: 40, food: 25, prod: 15 },
        { gold: 40, food: 25, prod: 15 },
      ];
      generateWorld();
      this.toggleMenu();
      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          const t = World.get(gx, gy);
          if (t && t.f === 1 && t.b === B.CAPITAL) {
            Camera.centreOn(gx, gy);
            break;
          }
        }
      }
      HUD.update();
      HUD.notify('⚔ A new realm rises — forge your legend!', 3000);
    },

    // Expose sub-systems for debugging / Shortcuts integration
    World, Camera, CameraControls, Renderer, AI, Combat, Save, HUD,
  };

  /* ── Expose globally ──────────────────────────────────────── */
  window.REALM = REALM;

  /* ── Boot ─────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => REALM.init());
  } else {
    REALM.init();
  }

})();
