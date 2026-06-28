/**
 * REALM CONQUEST — game.js
 * WebGL renderer, 50-degree isometric camera,
 * 100+ triangles per hex, land battles,
 * Main Tower HP (lose if destroyed),
 * 2 starting groups of 10 troops each,
 * Split groups, buildings, upgrades with 2-turn delivery
 */
(function(){
'use strict';

/* ══════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════ */
const HEX_SIZE   = 40;      // hex radius in world units
const GRID_W     = 48;
const GRID_H     = 48;
const CAM_ANGLE  = 50;      // degrees tilt
const RAD        = Math.PI/180;
const FPS        = 60;

// Camera iso projection constants for 50-degree tilt
// IsoX = (x - y) * cos(30°) * HEX_SIZE
// IsoY = (x + y) * sin(30°) * HEX_SIZE - z * HEIGHT_MOD
// then vertically squashed by sin(50°) ≈ 0.766
const COS30 = Math.cos(30*RAD); // 0.866
const SIN30 = Math.sin(30*RAD); // 0.5
const VTILT = Math.sin(CAM_ANGLE*RAD); // 0.766 — 50-degree tilt compression

// Terrain types (land only as requested)
const T = {PLAINS:0,FOREST:1,HILLS:2,MOUNTAIN:3,DESERT:4,SNOW:5,MARSH:6};
const TNAME = ['Plains','Forest','Hills','Mountain','Desert','Snow','Marsh'];
const TMOV  = [1.0,   0.7,   0.6,   0.4,    0.85,  0.65,  0.5 ]; // movement cost
const TDEF  = [0,     15,    20,     35,      5,     10,    10  ]; // defence bonus %

// Building types
const B = {NONE:0,MAIN_TOWER:1,HOUSE:2,BARRACKS:3,FORGE:4,ELITE_FORGE:5,WATCH_TOWER:6,WALLS:7};
const BNAME = ['','Main Tower','House','Barracks','Forge','Elite Forge','Watch Tower','Walls'];

// Faction colours — index 0 = player
const FC = ['#4a90d9','#d94a4a','#4ad95c','#d9c44a'];
const FN_DEFAULT = ['Blue Kingdom','Crimson Empire','Verdant League','Amber Sultanate'];

// AI faction names pool
const AI_NAMES = [
  'Crimson Empire','Iron Veil Dominion','Verdant Confederacy',
  'Amber Sultanate','Shadow Reach','The Obsidian Crown','Steel Covenant',
];

/* ══════════════════════════════════════════════
   WORLD STATE
══════════════════════════════════════════════ */
const World = {
  grid:[],      // flat array of hex cells
  groups:[],    // all troop groups (all factions)
  buildings:[], // placed buildings
  deliveries:[], // pending upgrade/equipment deliveries
  turn:1,
  factions:[],  // {name, color, isPlayer, alive}
  playerFaction:0,
  towerHP:500,
  towerMaxHP:500,
  seed:0,

  idx(q,r){return r*GRID_W+q;},
  get(q,r){
    if(q<0||r<0||q>=GRID_W||r>=GRID_H)return null;
    return this.grid[this.idx(q,r)];
  },

  // Noise-based terrain generation
  generate(seed){
    this.seed=seed||Math.floor(Math.random()*999999);
    this.grid=[];
    const s=this.seed;
    function n(x,y){
      return(Math.sin(x*.37+s*.001)*Math.cos(y*.31+s*.0013)+
             Math.sin(x*.71+s*.0007)*.6+
             Math.cos(y*.19+s*.0021)*.4+2)/4;
    }
    for(let r=0;r<GRID_H;r++){
      for(let q=0;q<GRID_W;q++){
        const h=n(q,r);
        const m=n(q*1.9,r*1.9);
        let t,z=0;
        if(h<.18){t=T.MARSH;z=0;}
        else if(h<.32){t=T.PLAINS;z=0;}
        else if(h<.50){t=m>.55?T.FOREST:T.PLAINS;z=1;}
        else if(h<.66){t=T.HILLS;z=1;}
        else if(h<.80){t=T.MOUNTAIN;z=2;}
        else{t=T.SNOW;z=3;}
        if(q/GRID_W>.6&&r/GRID_H<.4&&h>.2&&h<.6){t=T.DESERT;z=0;}
        this.grid.push({q,r,t,z,building:B.NONE,faction:-1,hp:0});
      }
    }
  },

  // Place player's Main Tower near center
  placeMainTower(){
    const cq=Math.floor(GRID_W/2), cr=Math.floor(GRID_H/2);
    for(let rad=0;rad<10;rad++){
      for(let dr=-rad;dr<=rad;dr++){
        for(let dq=-rad;dq<=rad;dq++){
          const cell=this.get(cq+dq,cr+dr);
          if(cell&&cell.t!==T.MOUNTAIN&&cell.t!==T.MARSH){
            cell.t=T.PLAINS;cell.z=0;
            cell.building=B.MAIN_TOWER;cell.faction=this.playerFaction;
            cell.hp=this.towerMaxHP;
            this.buildings.push({q:cq+dq,r:cr+dr,type:B.MAIN_TOWER,faction:this.playerFaction,hp:this.towerMaxHP,maxHP:this.towerMaxHP});
            return{q:cq+dq,r:cr+dr};
          }
        }
      }
    }
    return{q:cq,r:cr};
  },

  // Place AI capitals far from player
  placeAICapitals(){
    const corners=[
      {q:3,r:3},{q:GRID_W-4,r:3},
      {q:3,r:GRID_H-4},{q:GRID_W-4,r:GRID_H-4},
    ];
    for(let i=1;i<this.factions.length;i++){
      const c=corners[(i-1)%corners.length];
      for(let rad=0;rad<8;rad++){
        let placed=false;
        for(let dr=-rad;dr<=rad&&!placed;dr++){
          for(let dq=-rad;dq<=rad&&!placed;dq++){
            const cell=this.get(c.q+dq,c.r+dr);
            if(cell&&cell.t!==T.MOUNTAIN&&cell.t!==T.MARSH&&cell.building===B.NONE){
              cell.t=T.PLAINS;cell.z=0;
              cell.building=B.MAIN_TOWER;cell.faction=i;
              cell.hp=400;
              this.buildings.push({q:c.q+dq,r:c.r+dr,type:B.MAIN_TOWER,faction:i,hp:400,maxHP:400});
              placed=true;
            }
          }
        }
      }
    }
  },
};

/* ══════════════════════════════════════════════
   GROUP SYSTEM
══════════════════════════════════════════════ */
let gidCounter=0;
function makeGroup(faction,q,r,troops,name){
  return{
    id:gidCounter++,
    faction,q,r,troops,
    maxTroops:troops,
    name:name||`Group ${String.fromCharCode(65+gidCounter%26)}`,
    weapon:'Sword',armor:'Leather',
    morale:100,
    moved:false,
    attacked:false,
    alive:true,
  };
}

/* ══════════════════════════════════════════════
   CAMERA
══════════════════════════════════════════════ */
const Cam={
  x:0,y:0,       // pan offset in world units
  zoom:1,
  minZ:.25,maxZ:3,

  // Convert hex grid (q,r,elev) → screen pixel
  // 50-degree isometric projection:
  // IsoX = (q - r) * COS30 * HEX_SIZE
  // IsoY = ((q + r) * SIN30 * HEX_SIZE - elev*20) * VTILT
  hexToWorld(q,r,elev){
    elev=elev||0;
    const wx=(q-r)*COS30*HEX_SIZE;
    const wy=((q+r)*SIN30*HEX_SIZE - elev*22)*VTILT;
    return{wx,wy};
  },
  worldToScreen(wx,wy){
    const cx=GAME.canvas.width/2, cy=GAME.canvas.height/2;
    return{
      sx:(wx+this.x)*this.zoom+cx,
      sy:(wy+this.y)*this.zoom+cy,
    };
  },
  hexToScreen(q,r,elev){
    const{wx,wy}=this.hexToWorld(q,r,elev);
    return this.worldToScreen(wx,wy);
  },
  screenToHex(sx,sy){
    const cx=GAME.canvas.width/2,cy=GAME.canvas.height/2;
    const wx=(sx-cx)/this.zoom - this.x;
    const wy=(sy-cy)/this.zoom - this.y;
    // Invert iso projection (approximate, ignore elev)
    const wyU=wy/VTILT;
    const q=(wx/(COS30*HEX_SIZE) + wyU/(SIN30*HEX_SIZE))/2;
    const r=(wyU/(SIN30*HEX_SIZE) - wx/(COS30*HEX_SIZE))/2;
    return{q:Math.round(q),r:Math.round(r)};
  },
  visible(sx,sy){
    const pad=HEX_SIZE*this.zoom*3;
    return sx>-pad&&sx<GAME.canvas.width+pad&&sy>-pad&&sy<GAME.canvas.height+pad;
  },
  centreOn(q,r,elev){
    const{wx,wy}=this.hexToWorld(q,r,elev||0);
    this.x=-wx; this.y=-wy;
  },
};

/* ══════════════════════════════════════════════
   WEBGL RENDERER
   Each hex = triangle fan from center point
   Subdivisions = 12 → 12 triangles per hex face
   + cliff sides → total ~100+ triangles per hex
══════════════════════════════════════════════ */
const GL={
  gl:null,
  prog:null,
  buf:null,
  // Vertex + fragment shaders
  VS:`
    attribute vec2 aPos;
    attribute vec3 aColor;
    attribute float aAlpha;
    uniform vec2 uResolution;
    varying vec3 vColor;
    varying float vAlpha;
    void main(){
      vec2 clip = (aPos/uResolution)*2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      vColor = aColor;
      vAlpha = aAlpha;
    }
  `,
  FS:`
    precision mediump float;
    varying vec3 vColor;
    varying float vAlpha;
    void main(){
      gl_FragColor = vec4(vColor, vAlpha);
    }
  `,

  init(canvas){
    this.gl=canvas.getContext('webgl',{antialias:true,alpha:false})||
            canvas.getContext('experimental-webgl',{antialias:true,alpha:false});
    if(!this.gl){alert('WebGL not supported — try a newer browser');return false;}
    const gl=this.gl;

    // Compile shaders
    const vs=this._compile(gl.VERTEX_SHADER,this.VS);
    const fs=this._compile(gl.FRAGMENT_SHADER,this.FS);
    this.prog=gl.createProgram();
    gl.attachShader(this.prog,vs);gl.attachShader(this.prog,fs);
    gl.linkProgram(this.prog);
    if(!gl.getProgramParameter(this.prog,gl.LINK_STATUS)){
      console.error('Shader link failed',gl.getProgramInfoLog(this.prog));return false;
    }
    gl.useProgram(this.prog);

    // Buffer
    this.buf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buf);

    // Attribute locations
    this.aPos  =gl.getAttribLocation(this.prog,'aPos');
    this.aColor=gl.getAttribLocation(this.prog,'aColor');
    this.aAlpha=gl.getAttribLocation(this.prog,'aAlpha');
    this.uRes  =gl.getUniformLocation(this.prog,'uResolution');

    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aColor);
    gl.enableVertexAttribArray(this.aAlpha);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);

    return true;
  },

  _compile(type,src){
    const gl=this.gl;
    const s=gl.createShader(type);
    gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))
      console.error('Shader error',gl.getShaderInfoLog(s));
    return s;
  },

  // Draw all vertices in one batch
  // verts = Float32Array: [x,y, r,g,b, a,  x,y,r,g,b,a, ...]
  flush(verts){
    const gl=this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buf);
    gl.bufferData(gl.ARRAY_BUFFER,verts,gl.DYNAMIC_DRAW);
    const STRIDE=6*4; // 6 floats * 4 bytes
    gl.vertexAttribPointer(this.aPos,  2,gl.FLOAT,false,STRIDE,0);
    gl.vertexAttribPointer(this.aColor,3,gl.FLOAT,false,STRIDE,2*4);
    gl.vertexAttribPointer(this.aAlpha,1,gl.FLOAT,false,STRIDE,5*4);
    gl.drawArrays(gl.TRIANGLES,0,verts.length/6);
  },

  clear(r,g,b){
    const gl=this.gl;
    gl.clearColor(r,g,b,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uRes,GAME.canvas.width,GAME.canvas.height);
  },

  resize(w,h){
    if(this.gl){this.gl.viewport(0,0,w,h);}
  },
};

/* ══════════════════════════════════════════════
   VERTEX BUFFER BUILDER
   Builds triangle fans for each hex
   SUBDIVISIONS = 12 → 12 triangles per top face
   + 12*2 cliff triangles = ~36 per hex minimum
   With lighting variation across each triangle: visually smooth
══════════════════════════════════════════════ */
const SUBDIVISIONS = 12; // triangles around hex fan — 12 = smooth circle approx

// Hex corner points (flat-top, scaled to HEX_SIZE)
function hexCorner(cx,cy,i,size){
  const angle=(60*i-30)*RAD;
  return{x:cx+size*Math.cos(angle),y:cy+size*Math.sin(angle)};
}

// Push a triangle into Float32Array builder
function pushTri(arr,x0,y0,r0,g0,b0,a0, x1,y1,r1,g1,b1,a1, x2,y2,r2,g2,b2,a2){
  arr.push(x0,y0,r0,g0,b0,a0, x1,y1,r1,g1,b1,a1, x2,y2,r2,g2,b2,a2);
}

// Terrain palette: [topLight, topDark, cliffLight, cliffDark]
const TPAL=[
  [[0.55,0.78,0.32],[0.35,0.58,0.18],[0.30,0.50,0.14],[0.20,0.38,0.08]],// PLAINS
  [[0.18,0.48,0.12],[0.10,0.34,0.06],[0.12,0.34,0.08],[0.06,0.22,0.04]],// FOREST
  [[0.72,0.62,0.42],[0.52,0.44,0.28],[0.42,0.34,0.20],[0.28,0.22,0.12]],// HILLS
  [[0.58,0.54,0.62],[0.38,0.34,0.42],[0.32,0.28,0.36],[0.18,0.16,0.22]],// MOUNTAIN
  [[0.88,0.72,0.28],[0.70,0.54,0.16],[0.58,0.42,0.10],[0.40,0.28,0.06]],// DESERT
  [[0.88,0.92,0.96],[0.72,0.78,0.85],[0.64,0.70,0.78],[0.50,0.56,0.64]],// SNOW
  [[0.28,0.42,0.30],[0.18,0.30,0.20],[0.14,0.26,0.18],[0.10,0.18,0.12]],// MARSH
];

function buildHexVerts(arr, sx, sy, elev, terrainType, factionIdx, selAlpha, tick){
  const hw = HEX_SIZE * Cam.zoom;
  const hh = HEX_SIZE * VTILT * Cam.zoom;
  const cht= elev * 22 * VTILT * Cam.zoom;
  const pal= TPAL[terrainType] || TPAL[0];
  const tl = pal[0], td = pal[1], cl = pal[2], cd = pal[3];

  // Micro-noise shimmer (per tick per position) for surface detail
  const shimmer = Math.sin(tick*0.8 + sx*0.04 + sy*0.03)*0.025;

  // ── TOP FACE: triangle fan from center, SUBDIVISIONS segments
  // Center vertex (slightly lighter)
  const cx=sx, cy=sy+hh*0.5; // visual center of hex shifted down

  // Pre-compute the 6 screen-space hex corners (pointy-top for iso view)
  // We use an elliptical hex to simulate the iso tilt
  const corners=[];
  for(let i=0;i<6;i++){
    const ang=(60*i)*RAD;
    corners.push({
      x:cx + hw*0.866*Math.cos(ang),
      y:cy + hh*0.5*Math.sin(ang),
    });
  }

  // For each of the SUBDIVISIONS subdivisions around each of the 6 faces:
  // each face is split into (SUBDIVISIONS/6) radial slices
  const SLICES = SUBDIVISIONS; // slices per full circle = 12
  for(let s=0;s<SLICES;s++){
    const a0=(s/SLICES)*Math.PI*2;
    const a1=((s+1)/SLICES)*Math.PI*2;

    // Screen coords of the two arc points (elliptical to match iso view)
    const x0=cx+hw*0.9*Math.cos(a0), y0=cy+hh*0.5*Math.sin(a0);
    const x1=cx+hw*0.9*Math.cos(a1), y1=cy+hh*0.5*Math.sin(a1);

    // Lighting: NW-facing triangles are brighter
    const lum0 = 0.75 + Math.cos(a0-Math.PI*0.22)*0.22 + shimmer;
    const lum1 = 0.75 + Math.cos(a1-Math.PI*0.22)*0.22 + shimmer;
    const lumC = 0.9 + shimmer;

    const r0=tl[0]*lum0, g0=tl[1]*lum0, b0=tl[2]*lum0;
    const r1=tl[0]*lum1, g1=tl[1]*lum1, b1=tl[2]*lum1;
    const rc=tl[0]*lumC, gc=tl[1]*lumC, bc=tl[2]*lumC;

    pushTri(arr, cx,cy,rc,gc,bc,1, x0,y0,r0,g0,b0,1, x1,y1,r1,g1,b1,1);
  }

  // ── CLIFF SIDES (elevation > 0)
  if(elev>0&&cht>0){
    // Left cliff: western half of the hex (a = PI..2PI range approx)
    // Right cliff: eastern half
    const CSLICES=8;
    for(let s=0;s<CSLICES;s++){
      const a0=Math.PI+(s/CSLICES)*Math.PI;
      const a1=Math.PI+((s+1)/CSLICES)*Math.PI;
      const x0=cx+hw*0.88*Math.cos(a0), y0=cy+hh*0.5*Math.sin(a0);
      const x1=cx+hw*0.88*Math.cos(a1), y1=cy+hh*0.5*Math.sin(a1);
      const lum=0.5+Math.cos(a0-Math.PI*1.5)*0.2;
      const r=cl[0]*lum, g=cl[1]*lum, b=cl[2]*lum;
      const rd=cd[0]*lum*.75, gd=cd[1]*lum*.75, bd=cd[2]*lum*.75;
      // Two triangles per cliff segment
      pushTri(arr, x0,y0,r,g,b,1, x1,y1,r,g,b,1, x1,y1+cht,rd,gd,bd,1);
      pushTri(arr, x0,y0,r,g,b,1, x1,y1+cht,rd,gd,bd,1, x0,y0+cht,rd,gd,bd,1);
    }
    // Right cliff
    for(let s=0;s<CSLICES;s++){
      const a0=(s/CSLICES)*Math.PI;
      const a1=((s+1)/CSLICES)*Math.PI;
      const x0=cx+hw*0.88*Math.cos(a0), y0=cy+hh*0.5*Math.sin(a0);
      const x1=cx+hw*0.88*Math.cos(a1), y1=cy+hh*0.5*Math.sin(a1);
      const lum=0.42+Math.cos(a0)*0.15;
      const r=cl[0]*lum, g=cl[1]*lum, b=cl[2]*lum;
      const rd=cd[0]*lum*.7, gd=cd[1]*lum*.7, bd=cd[2]*lum*.7;
      pushTri(arr, x0,y0,r,g,b,1, x1,y1,r,g,b,1, x1,y1+cht,rd,gd,bd,1);
      pushTri(arr, x0,y0,r,g,b,1, x1,y1+cht,rd,gd,bd,1, x0,y0+cht,rd,gd,bd,1);
    }
  }

  // ── FACTION TERRITORY OVERLAY (transparent colored wash)
  if(factionIdx>=0){
    const fc=hexToRGB(FC[factionIdx]);
    const isPlayer=(factionIdx===World.playerFaction);
    const alpha=isPlayer?0.18:0.12;
    const ba=isPlayer?0.65:0.38;
    // Solid fill overlay
    for(let s=0;s<SLICES;s++){
      const a0=(s/SLICES)*Math.PI*2, a1=((s+1)/SLICES)*Math.PI*2;
      const x0=cx+hw*0.88*Math.cos(a0), y0=cy+hh*0.48*Math.sin(a0);
      const x1=cx+hw*0.88*Math.cos(a1), y1=cy+hh*0.48*Math.sin(a1);
      pushTri(arr, cx,cy,fc[0],fc[1],fc[2],alpha, x0,y0,fc[0],fc[1],fc[2],alpha, x1,y1,fc[0],fc[1],fc[2],alpha);
    }
    // Border ring
    const BSLICES=24;
    for(let s=0;s<BSLICES;s++){
      const a0=(s/BSLICES)*Math.PI*2, a1=((s+1)/BSLICES)*Math.PI*2;
      const ir=0.82,or=0.90;
      const xi0=cx+hw*ir*Math.cos(a0),yi0=cy+hh*0.48*ir*Math.sin(a0);
      const xi1=cx+hw*ir*Math.cos(a1),yi1=cy+hh*0.48*ir*Math.sin(a1);
      const xo0=cx+hw*or*Math.cos(a0),yo0=cy+hh*0.48*or*Math.sin(a0);
      const xo1=cx+hw*or*Math.cos(a1),yo1=cy+hh*0.48*or*Math.sin(a1);
      pushTri(arr, xi0,yi0,fc[0],fc[1],fc[2],ba, xo0,yo0,fc[0],fc[1],fc[2],ba, xi1,yi1,fc[0],fc[1],fc[2],ba);
      pushTri(arr, xo0,yo0,fc[0],fc[1],fc[2],ba, xo1,yo1,fc[0],fc[1],fc[2],ba, xi1,yi1,fc[0],fc[1],fc[2],ba);
    }
  }

  // ── SELECTION HIGHLIGHT
  if(selAlpha>0){
    const pulse=0.5+Math.sin(tick*3)*0.35;
    const BSLICES=18;
    for(let s=0;s<BSLICES;s++){
      const a0=(s/BSLICES)*Math.PI*2, a1=((s+1)/BSLICES)*Math.PI*2;
      const ir=0.78,or=0.92;
      const xi0=cx+hw*ir*Math.cos(a0),yi0=cy+hh*0.48*ir*Math.sin(a0);
      const xi1=cx+hw*ir*Math.cos(a1),yi1=cy+hh*0.48*ir*Math.sin(a1);
      const xo0=cx+hw*or*Math.cos(a0),yo0=cy+hh*0.48*or*Math.sin(a0);
      const xo1=cx+hw*or*Math.cos(a1),yo1=cy+hh*0.48*or*Math.sin(a1);
      const a=pulse*selAlpha;
      pushTri(arr, xi0,yi0,1,.85,.2,a, xo0,yo0,1,.85,.2,a, xi1,yi1,1,.85,.2,a);
      pushTri(arr, xo0,yo0,1,.85,.2,a, xo1,yo1,1,.85,.2,a, xi1,yi1,1,.85,.2,a);
    }
  }
}

// Draw building/group overlays using Canvas 2D on top of WebGL
// (Canvas 2D used for text labels, icons — WebGL handles terrain)
const Overlay={
  canvas:null, ctx:null,
  init(){
    this.canvas=document.createElement('canvas');
    this.canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    document.body.appendChild(this.canvas);
    this.ctx=this.canvas.getContext('2d');
  },
  resize(w,h){this.canvas.width=w;this.canvas.height=h;},
  clear(){this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);},
  drawBuilding(sx,sy,type,faction,hp,maxHP){
    const ctx=this.ctx;
    const z=Math.max(.4,Cam.zoom);
    const icons={[B.MAIN_TOWER]:'🏰',[B.HOUSE]:'🏠',[B.BARRACKS]:'⚔',[B.FORGE]:'🔨',[B.ELITE_FORGE]:'⚙',[B.WATCH_TOWER]:'🗼',[B.WALLS]:'🧱'};
    const icon=icons[type]||'🏗';
    const fs=Math.max(10,16*z);
    ctx.font=`${fs}px sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(icon,sx,sy-12*z);
    // HP bar for main tower
    if(type===B.MAIN_TOWER){
      const bw=40*z,bh=5*z;
      const pct=Math.max(0,hp/maxHP);
      ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(sx-bw/2,sy-24*z,bw,bh);
      const hc=pct>.6?'#4ad95c':pct>.3?'#f5c842':'#d94a4a';
      ctx.fillStyle=hc;ctx.fillRect(sx-bw/2,sy-24*z,bw*pct,bh);
    }
    // Faction color dot
    if(faction>=0){
      ctx.beginPath();ctx.arc(sx+10*z,sy-20*z,3*z,0,Math.PI*2);
      ctx.fillStyle=FC[faction]||'#aaa';ctx.fill();
    }
  },
  drawGroup(sx,sy,group){
    if(!group.alive||group.troops<=0)return;
    const ctx=this.ctx;
    const z=Math.max(.35,Cam.zoom);
    const fc=FC[group.faction]||'#aaa';
    const isPlayer=(group.faction===World.playerFaction);
    const r=(isPlayer?14:11)*z;
    const selected=(GAME.selGroup&&GAME.selGroup.id===group.id);

    // Shadow
    ctx.beginPath();ctx.ellipse(sx,sy+r*.35,r*.7,r*.25,0,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,.3)';ctx.fill();

    // Body — polygon for smooth look
    const segs=14;
    ctx.beginPath();
    for(let s=0;s<=segs;s++){
      const a=(s/segs)*Math.PI*2;
      const pr=r*(1+(selected?Math.sin(GAME.tick*3)*.08:.02));
      if(s===0)ctx.moveTo(sx+Math.cos(a)*pr,sy+Math.sin(a)*pr);
      else ctx.lineTo(sx+Math.cos(a)*pr,sy+Math.sin(a)*pr);
    }
    ctx.closePath();
    const grd=ctx.createRadialGradient(sx-r*.28,sy-r*.28,r*.08,sx,sy,r);
    grd.addColorStop(0,lightenHex(fc,40));grd.addColorStop(1,fc);
    ctx.fillStyle=grd;ctx.fill();
    ctx.strokeStyle=isPlayer?'#f5c842':'rgba(255,255,255,.65)';
    ctx.lineWidth=isPlayer?(selected?3:2.2):1.4;ctx.stroke();

    // Troop count
    ctx.fillStyle='#fff';
    ctx.font=`bold ${Math.max(8,Math.round(9*z))}px Courier New`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(group.troops,sx,sy);ctx.textBaseline='alphabetic';

    // Crown for player
    if(isPlayer&&z>.45){
      ctx.font=`${Math.max(7,Math.round(8*z))}px sans-serif`;
      ctx.fillStyle='#f5c842';
      ctx.fillText('♔',sx,sy-r-3*z);
    }
    // Moved indicator
    if(group.moved){
      ctx.globalAlpha=0.4;
      ctx.fillStyle='rgba(0,0,0,.5)';
      ctx.beginPath();ctx.arc(sx,sy,r,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;
    }
    // Group name (only if player and zoomed in)
    if(isPlayer&&z>0.8){
      ctx.font=`${Math.max(7,Math.round(7*z))}px Courier New`;
      ctx.fillStyle='rgba(232,213,163,.75)';
      ctx.textAlign='center';
      ctx.fillText(group.name,sx,sy+r+9*z);
    }
  },
  drawMoveRange(hexes){
    const ctx=this.ctx;
    for(const{q,r}of hexes){
      const cell=World.get(q,r);if(!cell)continue;
      const s=Cam.hexToScreen(q,r,cell.z);
      if(!Cam.visible(s.sx,s.sy))continue;
      const z=Cam.zoom;
      const hw=HEX_SIZE*.85*z, hh=HEX_SIZE*VTILT*.48*z;
      ctx.strokeStyle='rgba(74,144,217,.7)';ctx.lineWidth=2;
      ctx.beginPath();
      for(let i=0;i<6;i++){
        const a=(60*i)*RAD;
        const px=s.sx+hw*Math.cos(a), py=s.sy+hh*Math.sin(a);
        if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
      }
      ctx.closePath();ctx.stroke();
      ctx.fillStyle='rgba(74,144,217,.1)';ctx.fill();
    }
  },
  drawAttackRange(hexes){
    const ctx=this.ctx;
    for(const{q,r}of hexes){
      const cell=World.get(q,r);if(!cell)continue;
      const s=Cam.hexToScreen(q,r,cell.z);
      if(!Cam.visible(s.sx,s.sy))continue;
      const z=Cam.zoom;
      const hw=HEX_SIZE*.85*z, hh=HEX_SIZE*VTILT*.48*z;
      ctx.strokeStyle='rgba(217,74,74,.8)';ctx.lineWidth=2;
      ctx.beginPath();
      for(let i=0;i<6;i++){
        const a=(60*i)*RAD;
        const px=s.sx+hw*Math.cos(a), py=s.sy+hh*Math.sin(a);
        if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
      }
      ctx.closePath();ctx.stroke();
      ctx.fillStyle='rgba(217,74,74,.12)';ctx.fill();
    }
  },
};

/* ══════════════════════════════════════════════
   HEX GRID HELPERS
══════════════════════════════════════════════ */
function hexNeighbours(q,r){
  return[[q+1,r],[q-1,r],[q,r+1],[q,r-1],[q+1,r-1],[q-1,r+1]]
    .map(([qq,rr])=>({q:qq,r:rr}))
    .filter(h=>World.get(h.q,h.r)!==null);
}

function hexDistance(q0,r0,q1,r1){
  return(Math.abs(q0-q1)+Math.abs(q0+r0-q1-r1)+Math.abs(r0-r1))/2;
}

// BFS move range
function getMoveRange(q,r,steps){
  const visited=new Map();
  visited.set(`${q},${r}`,0);
  const queue=[{q,r,steps}];
  const result=[];
  while(queue.length){
    const{q:cq,r:cr,steps:cs}=queue.shift();
    if(cs<=0)continue;
    for(const nb of hexNeighbours(cq,cr)){
      const key=`${nb.q},${nb.r}`;
      const cell=World.get(nb.q,nb.r);
      if(!cell||visited.has(key))continue;
      const cost=1/TMOV[cell.t];
      if(cs>=cost){
        visited.set(key,1);
        result.push({q:nb.q,r:nb.r});
        queue.push({q:nb.q,r:nb.r,steps:cs-cost});
      }
    }
  }
  return result;
}

/* ══════════════════════════════════════════════
   BUILDINGS & UPGRADES CATALOG
══════════════════════════════════════════════ */
const BUILD_CATALOG=[
  {id:B.HOUSE,       name:'House',        gold:80,  prod:20, turns:1, troopsPerTurn:5,  desc:'Produces 5 troops/turn'},
  {id:B.BARRACKS,    name:'Barracks',     gold:150, prod:40, turns:2, troopsPerTurn:12, desc:'Produces 12 troops/turn'},
  {id:B.FORGE,       name:'Forge',        gold:200, prod:60, turns:3, troopsPerTurn:0,  desc:'Unlocks iron weapons & armor upgrades'},
  {id:B.ELITE_FORGE, name:'Elite Forge',  gold:400, prod:120,turns:4, troopsPerTurn:0,  desc:'Unlocks tanks & siege engines'},
  {id:B.WATCH_TOWER, name:'Watch Tower',  gold:100, prod:30, turns:2, troopsPerTurn:0,  desc:'+20% defence in adjacent hexes'},
  {id:B.WALLS,       name:'Walls',        gold:120, prod:35, turns:2, troopsPerTurn:0,  desc:'+35% defence on this hex'},
];

const UPGRADE_CATALOG=[
  // Weapons
  {id:'iron_sword', name:'Iron Swords',     gold:100,prod:30,turns:2,req:B.FORGE,      desc:'+15% attack',  stat:{atkBonus:15}, delivery:2},
  {id:'steel_sword',name:'Steel Swords',    gold:200,prod:60,turns:2,req:B.FORGE,      desc:'+25% attack',  stat:{atkBonus:25}, delivery:2},
  {id:'war_axe',    name:'War Axes',        gold:180,prod:55,turns:2,req:B.FORGE,      desc:'+20% atk, -5% def',stat:{atkBonus:20,defMalus:5},delivery:2},
  {id:'siege_eng',  name:'Siege Engine',    gold:450,prod:140,turns:4,req:B.ELITE_FORGE,desc:'+60% atk vs buildings',stat:{siegeBonus:60},delivery:2},
  {id:'iron_tank',  name:'Iron Tank',       gold:600,prod:180,turns:5,req:B.ELITE_FORGE,desc:'+40% atk, +30% def, -30% move',stat:{atkBonus:40,defBonus:30,moveMalus:30},delivery:2},
  // Armor
  {id:'leather_2',  name:'Hardened Leather',gold:80, prod:25,turns:2,req:B.NONE,       desc:'+10% defence',stat:{defBonus:10}, delivery:2},
  {id:'chain_mail', name:'Chain Mail',      gold:160,prod:50,turns:2,req:B.FORGE,      desc:'+20% defence',stat:{defBonus:20}, delivery:2},
  {id:'plate_armor',name:'Plate Armor',     gold:300,prod:90,turns:2,req:B.FORGE,      desc:'+35% defence, -10% move',stat:{defBonus:35,moveMalus:10},delivery:2},
  {id:'elite_plate',name:'Elite Plate',     gold:500,prod:150,turns:2,req:B.ELITE_FORGE,desc:'+50% def, -15% move',stat:{defBonus:50,moveMalus:15},delivery:2},
];

/* ══════════════════════════════════════════════
   AI
══════════════════════════════════════════════ */
const AI={
  runTurn(factionIdx){
    const groups=World.groups.filter(g=>g.faction===factionIdx&&g.alive&&g.troops>0);
    if(!groups.length)return;

    for(const g of groups){
      if(g.moved)continue;
      // Find nearest enemy group or player's main tower
      let bestTarget=null, bestDist=999;
      const enemies=World.groups.filter(e=>e.faction!==factionIdx&&e.alive&&e.troops>0);
      for(const e of enemies){
        const d=hexDistance(g.q,g.r,e.q,e.r);
        if(d<bestDist){bestDist=d;bestTarget=e;}
      }
      // Also target player main tower
      const ptower=World.buildings.find(b=>b.type===B.MAIN_TOWER&&b.faction===World.playerFaction);
      if(ptower){
        const d=hexDistance(g.q,g.r,ptower.q,ptower.r);
        if(d<bestDist){bestDist=d;bestTarget={q:ptower.q,r:ptower.r,isTower:true,faction:World.playerFaction};}
      }

      if(!bestTarget){g.moved=true;continue;}

      // Try to attack adjacent
      if(bestDist<=1.5&&!bestTarget.isTower){
        Combat.resolve(g,bestTarget,factionIdx);
        g.moved=true;g.attacked=true;
      } else if(bestDist<=1.5&&bestTarget.isTower){
        // Attack tower
        const dmg=Math.floor(g.troops*0.08*(0.8+Math.random()*.4));
        World.towerHP=Math.max(0,World.towerHP-dmg);
        const bld=World.buildings.find(b=>b.type===B.MAIN_TOWER&&b.faction===World.playerFaction);
        if(bld)bld.hp=World.towerHP;
        GAME.blogAdd(`${World.factions[factionIdx].name} attacked your Main Tower for ${dmg} damage!`,'d');
        g.moved=true;g.attacked=true;
      } else {
        // Move toward target
        const range=getMoveRange(g.q,g.r,3);
        if(range.length){
          let best=range[0], bd=999;
          for(const h of range){
            const d=hexDistance(h.q,h.r,bestTarget.q,bestTarget.r);
            // Don't step on another group
            const occ=World.groups.find(gg=>gg.alive&&gg.q===h.q&&gg.r===h.r);
            if(!occ&&d<bd){bd=d;best=h;}
          }
          g.q=best.q;g.r=best.r;
        }
        g.moved=true;
      }
    }
  },
};

/* ══════════════════════════════════════════════
   COMBAT
══════════════════════════════════════════════ */
const Combat={
  resolve(attacker, defender, atkFac){
    if(!attacker.alive||!defender.alive)return;
    const cell=World.get(defender.q,defender.r)||{t:T.PLAINS};
    const defBonus=TDEF[cell.t]/100;
    const atkStr=attacker.troops*(0.7+Math.random()*.6);
    const defStr=defender.troops*(0.65+Math.random()*.55)*(1+defBonus);
    const atkLoss=Math.ceil(defStr*.18);
    const defLoss=Math.ceil(atkStr*.22);
    attacker.troops=Math.max(0,attacker.troops-atkLoss);
    defender.troops=Math.max(0,defender.troops-defLoss);
    const an=World.factions[atkFac]?.name||'Unknown';
    const dn=World.factions[defender.faction]?.name||'Unknown';
    if(defender.troops<=0){
      defender.alive=false;
      GAME.blogAdd(`${an} wiped out ${dn}'s ${defender.name}!`,'v');
    } else {
      GAME.blogAdd(`${an} attacked ${dn}: Atk-${atkLoss} Def-${defLoss}`,'i');
    }
    if(attacker.troops<=0){attacker.alive=false;}
  },
};

/* ══════════════════════════════════════════════
   INPUT HANDLER
══════════════════════════════════════════════ */
const Input={
  drag:false,lx:0,ly:0,pinch:false,pd:0,tap:null,TD:12,TT:230,
  init(canvas){
    canvas.addEventListener('touchstart',e=>this.ts(e),{passive:false});
    canvas.addEventListener('touchmove', e=>this.tm(e),{passive:false});
    canvas.addEventListener('touchend',  e=>this.te(e),{passive:false});
    canvas.addEventListener('touchcancel',e=>this.te(e),{passive:false});
    canvas.addEventListener('mousedown', e=>this.md(e));
    canvas.addEventListener('mousemove', e=>this.mm(e));
    canvas.addEventListener('mouseup',   e=>this.mu(e));
    canvas.addEventListener('wheel',     e=>this.wh(e),{passive:false});
  },
  d2(t){const dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY;return Math.sqrt(dx*dx+dy*dy);},
  ts(e){e.preventDefault();
    if(e.touches.length===2){this.pinch=true;this.drag=false;this.pd=this.d2(e.touches);return;}
    const t=e.touches[0];this.drag=true;this.pinch=false;this.lx=t.clientX;this.ly=t.clientY;
    this.tap={x:t.clientX,y:t.clientY,time:Date.now()};
  },
  tm(e){e.preventDefault();
    if(this.pinch&&e.touches.length===2){
      const d=this.d2(e.touches),sc=d/this.pd;this.pd=d;
      this.doZoom(sc,(e.touches[0].clientX+e.touches[1].clientX)/2,(e.touches[0].clientY+e.touches[1].clientY)/2);return;
    }
    if(this.drag&&e.touches.length===1){
      const t=e.touches[0];
      Cam.x+=(t.clientX-this.lx)/Cam.zoom;Cam.y+=(t.clientY-this.ly)/Cam.zoom;
      this.lx=t.clientX;this.ly=t.clientY;
      if(this.tap&&Math.hypot(t.clientX-this.tap.x,t.clientY-this.tap.y)>this.TD)this.tap=null;
    }
  },
  te(e){e.preventDefault();this.pinch=false;
    if(!e.touches.length){this.drag=false;
      if(this.tap&&Date.now()-this.tap.time<this.TT)GAME.onTap(this.tap.x,this.tap.y);
      this.tap=null;
    }
  },
  md(e){this.drag=true;this.lx=e.clientX;this.ly=e.clientY;this.tap={x:e.clientX,y:e.clientY,time:Date.now()};},
  mm(e){if(!this.drag)return;Cam.x+=(e.clientX-this.lx)/Cam.zoom;Cam.y+=(e.clientY-this.ly)/Cam.zoom;this.lx=e.clientX;this.ly=e.clientY;if(this.tap&&Math.hypot(e.clientX-this.tap.x,e.clientY-this.tap.y)>this.TD)this.tap=null;},
  mu(e){this.drag=false;if(this.tap&&Date.now()-this.tap.time<this.TT)GAME.onTap(this.tap.x,this.tap.y);this.tap=null;},
  wh(e){e.preventDefault();this.doZoom(e.deltaY<0?1.12:.88,e.clientX,e.clientY);},
  doZoom(sc,fx,fy){
    const old=Cam.zoom;
    Cam.zoom=Math.max(Cam.minZ,Math.min(Cam.maxZ,Cam.zoom*sc));
    const ratio=Cam.zoom/old-1;
    const cx=GAME.canvas.width/2,cy=GAME.canvas.height/2;
    Cam.x-=(fx-cx)/old*ratio; Cam.y-=(fy-cy)/old*ratio;
  },
};

/* ══════════════════════════════════════════════
   HOME SCREEN ANIMATION
══════════════════════════════════════════════ */
const HomeAnim={
  canvas:null,ctx:null,t:0,raf:null,pts:[],
  init(){
    this.canvas=document.getElementById('home-bg');
    if(!this.canvas)return;
    this.ctx=this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize',()=>this.resize());
    this.pts=[];
    for(let i=0;i<60;i++)this.pts.push({
      x:Math.random(),y:Math.random(),
      vx:(Math.random()-.5)*.00016,vy:(Math.random()-.5)*.00009,
      r:Math.random()*2+.4,a:Math.random()*.5+.1,
      col:Math.random()>.5?'#c8860a':'#4a90d9',
    });
    if(this.raf)cancelAnimationFrame(this.raf);
    this.loop();
  },
  resize(){if(this.canvas){this.canvas.width=window.innerWidth;this.canvas.height=window.innerHeight;}},
  loop(){this.raf=requestAnimationFrame(()=>this.loop());this.draw();},
  draw(){
    if(!this.ctx)return;
    const ctx=this.ctx,W=this.canvas.width,H=this.canvas.height;
    this.t+=.007;
    const bg=ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0,'#030508');bg.addColorStop(.5,'#07101a');bg.addColorStop(1,'#0a1420');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    // Animated iso grid hint
    ctx.save();ctx.globalAlpha=.05;ctx.strokeStyle='#c8860a';ctx.lineWidth=1;
    const tw=88,th=44,off=(this.t*6)%tw;
    for(let gx=-2;gx<W/tw*2+2;gx++)for(let gy=-2;gy<H/th+2;gy++){
      const sx=(gx-gy)*tw/2+off+W/2,sy=(gx+gy)*th/2*VTILT+H*.4;
      ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx+tw/2,sy+th/2*VTILT);
      ctx.lineTo(sx,sy+th*VTILT);ctx.lineTo(sx-tw/2,sy+th/2*VTILT);ctx.closePath();ctx.stroke();
    }
    ctx.restore();
    for(const p of this.pts){
      p.x+=p.vx;p.y+=p.vy;
      if(p.x<0)p.x=1;if(p.x>1)p.x=0;if(p.y<0)p.y=1;if(p.y>1)p.y=0;
      ctx.beginPath();ctx.arc(p.x*W,p.y*H,p.r,0,Math.PI*2);
      ctx.fillStyle=p.col;ctx.globalAlpha=p.a*(.7+Math.sin(this.t*2+p.x*10)*.3);ctx.fill();
    }
    ctx.globalAlpha=1;
    const gl=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W*.44);
    gl.addColorStop(0,`rgba(200,134,10,${.05+Math.sin(this.t)*.018})`);
    gl.addColorStop(.5,`rgba(74,144,217,${.032+Math.cos(this.t*.7)*.015})`);
    gl.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gl;ctx.fillRect(0,0,W,H);
  },
  stop(){if(this.raf){cancelAnimationFrame(this.raf);this.raf=null;}},
};

/* ══════════════════════════════════════════════
   SAVE / LOAD
══════════════════════════════════════════════ */
const Save={
  KEY:'realm_conquest_save',
  save(){
    const d={
      grid:World.grid,groups:World.groups,buildings:World.buildings,
      deliveries:World.deliveries,turn:World.turn,factions:World.factions,
      playerFaction:World.playerFaction,towerHP:World.towerHP,
      towerMaxHP:World.towerMaxHP,seed:World.seed,
      playerRes:GAME.playerRes,empireName:GAME.empireName,empireColor:GAME.empireColor,
    };
    try{localStorage.setItem(this.KEY,JSON.stringify(d));GAME.toast('💾 Saved');return JSON.stringify(d);}
    catch(e){GAME.toast('Save failed');return null;}
  },
  load(){
    try{
      const raw=localStorage.getItem(this.KEY)||window.SHORTCUTS_SAVE;
      if(!raw)return false;
      const d=JSON.parse(raw);
      Object.assign(World,{grid:d.grid,groups:d.groups,buildings:d.buildings,
        deliveries:d.deliveries,turn:d.turn,factions:d.factions,
        playerFaction:d.playerFaction,towerHP:d.towerHP,
        towerMaxHP:d.towerMaxHP,seed:d.seed});
      GAME.playerRes=d.playerRes;
      GAME.empireName=d.empireName||'Your Empire';
      GAME.empireColor=d.empireColor||'#4a90d9';
      return true;
    }catch(e){return false;}
  },
};

/* ══════════════════════════════════════════════
   COLOUR HELPERS
══════════════════════════════════════════════ */
function hexToRGB(hex){
  const n=parseInt(hex.replace('#',''),16);
  return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];
}
function lightenHex(hex,pct){
  const n=parseInt(hex.replace('#',''),16);
  const f=1+pct/100;
  return `rgb(${Math.min(255,Math.floor(((n>>16)&255)*f))},${Math.min(255,Math.floor(((n>>8)&255)*f))},${Math.min(255,Math.floor((n&255)*f))})`;
}

/* ══════════════════════════════════════════════
   MAIN GAME CONTROLLER
══════════════════════════════════════════════ */
const GAME={
  canvas:null,
  empireName:'Your Empire',
  empireColor:'#4a90d9',
  playerRes:{gold:500,food:200,prod:100},
  selGroup:null,    // selected group
  selHex:null,      // selected hex {q,r}
  moveRange:[],
  attackRange:[],
  tick:0,
  lastT:0,
  frid:null,
  menuOpen:false,
  splitCount:2,
  battleLog:[],
  MAX_LOG:8,

  init(){
    this.canvas=document.getElementById('game-canvas');
    this.resize();
    window.addEventListener('resize',()=>this.resize());

    if(!GL.init(this.canvas)){return;}
    Overlay.init();
    Input.init(this.canvas);

    // Wire all buttons
    this._wireButtons();
    HomeAnim.init();

    // Color picker
    document.querySelectorAll('.cpick').forEach(el=>{
      el.addEventListener('click',()=>{
        document.querySelectorAll('.cpick').forEach(c=>c.classList.remove('active'));
        el.classList.add('active');
        this.empireColor=el.dataset.col;
      });
    });
  },

  resize(){
    const w=window.innerWidth,h=window.innerHeight;
    if(this.canvas){this.canvas.width=w;this.canvas.height=h;}
    GL.resize(w,h);
    Overlay.resize(w,h);
  },

  _wireButtons(){
    // Home screen
    document.getElementById('btn-start')?.addEventListener('click',()=>this.startNew());
    document.getElementById('btn-continue')?.addEventListener('click',()=>this.startLoad());
    // HUD
    document.getElementById('btn-end-turn')?.addEventListener('click',()=>this.endTurn());
    document.getElementById('btn-build')?.addEventListener('click',()=>this.openBuild());
    document.getElementById('btn-upgrade')?.addEventListener('click',()=>this.openUpgrade());
    document.getElementById('btn-split')?.addEventListener('click',()=>this.openSplit());
    document.getElementById('btn-save')?.addEventListener('click',()=>Save.save());
    document.getElementById('btn-menu-open')?.addEventListener('click',()=>this.toggleMenu());
    document.getElementById('btn-build-close')?.addEventListener('click',()=>document.getElementById('build-menu').classList.add('hidden'));
    document.getElementById('btn-upgrade-close')?.addEventListener('click',()=>document.getElementById('upgrade-menu').classList.add('hidden'));
    document.getElementById('btn-split-close')?.addEventListener('click',()=>document.getElementById('split-menu').classList.add('hidden'));
    document.getElementById('btn-split-confirm')?.addEventListener('click',()=>this.confirmSplit());
    document.getElementById('btn-save2')?.addEventListener('click',()=>Save.save());
    document.getElementById('btn-home')?.addEventListener('click',()=>this.goHome());
    document.getElementById('btn-menu-close')?.addEventListener('click',()=>this.toggleMenu());
    document.getElementById('gi-close')?.addEventListener('click',()=>{this.selGroup=null;this.moveRange=[];this.attackRange=[];document.getElementById('group-info').classList.add('hidden');});
    document.getElementById('hex-info-close')?.addEventListener('click',()=>document.getElementById('hex-info').classList.add('hidden'));
    document.getElementById('btn-gameover-home')?.addEventListener('click',()=>this.goHome());
    document.getElementById('btn-victory-home')?.addEventListener('click',()=>this.goHome());
    // Split count buttons
    document.getElementById('sc-2')?.addEventListener('click',()=>this.setSplitCount(2));
    document.getElementById('sc-3')?.addEventListener('click',()=>this.setSplitCount(3));
    // D-pad
    const dpan=(id,dq,dr)=>{
      const el=document.getElementById(id);if(!el)return;
      let held=null;
      const step=()=>{Cam.x-=dq*HEX_SIZE*.6;Cam.y-=dr*HEX_SIZE*.6*VTILT;};
      el.addEventListener('click',step);
      el.addEventListener('touchstart',(e)=>{e.preventDefault();step();held=setInterval(step,80);},{passive:false});
      el.addEventListener('touchend',(e)=>{e.preventDefault();clearInterval(held);},{passive:false});
      el.addEventListener('mousedown',()=>{step();held=setInterval(step,80);});
      el.addEventListener('mouseup',()=>clearInterval(held));
      el.addEventListener('mouseleave',()=>clearInterval(held));
    };
    dpan('dp-u', 0,-1);dpan('dp-d', 0, 1);dpan('dp-l',-1, 0);dpan('dp-r', 1, 0);
    document.getElementById('btn-zi')?.addEventListener('click',()=>Input.doZoom(1.2,this.canvas.width/2,this.canvas.height/2));
    document.getElementById('btn-zo')?.addEventListener('click',()=>Input.doZoom(.82,this.canvas.width/2,this.canvas.height/2));
    document.getElementById('btn-zr')?.addEventListener('click',()=>this.resetCam());
  },

  startNew(){
    const nameEl=document.getElementById('empire-name');
    this.empireName=(nameEl?.value?.trim())||'Your Empire';
    HomeAnim.stop();
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    this._newCampaign();
    if(this.frid)cancelAnimationFrame(this.frid);
    this.frid=requestAnimationFrame(t=>this._loop(t));
  },

  startLoad(){
    if(Save.load()){
      HomeAnim.stop();
      document.getElementById('home-screen').classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      this.updateHUD();this.resetCam();
      if(this.frid)cancelAnimationFrame(this.frid);
      this.frid=requestAnimationFrame(t=>this._loop(t));
      this.toast('📂 Campaign restored!',3000);
    }else{
      const b=document.getElementById('btn-start');
      this.toast('No save found — start a New Campaign');
      if(b){b.style.boxShadow='0 0 0 3px #f5c842';setTimeout(()=>b.style.boxShadow='',1800);}
    }
  },

  _newCampaign(){
    gidCounter=0;
    // Set up factions
    const aiNames=AI_NAMES.sort(()=>Math.random()-.5);
    World.factions=[
      {name:this.empireName,  color:this.empireColor, isPlayer:true, alive:true},
      {name:aiNames[0],       color:FC[1],            isPlayer:false,alive:true},
      {name:aiNames[1],       color:FC[2],            isPlayer:false,alive:true},
      {name:aiNames[2],       color:FC[3],            isPlayer:false,alive:true},
    ];
    World.playerFaction=0;
    World.towerHP=500;World.towerMaxHP=500;
    World.turn=1;
    World.deliveries=[];
    World.buildings=[];
    World.groups=[];
    this.playerRes={gold:500,food:200,prod:100};

    // Generate land-only world
    World.generate();

    // Place main tower, get position
    const towerPos=World.placeMainTower();
    World.placeAICapitals();

    // Player starts with 2 groups of 10 troops near the tower
    const g1=makeGroup(0,towerPos.q-1,towerPos.r,'10','Iron Guard');
    const g2=makeGroup(0,towerPos.q+1,towerPos.r,'10','Shield Wall');
    g1.troops=10;g2.troops=10;
    World.groups.push(g1,g2);

    // AI groups (3 each, 15 troops)
    for(let f=1;f<4;f++){
      const cap=World.buildings.find(b=>b.faction===f&&b.type===B.MAIN_TOWER);
      if(!cap)continue;
      const names=['Vanguard','Flankers','Rear Guard'];
      for(let k=0;k<3;k++){
        const g=makeGroup(f,cap.q+(k-1),cap.r+1,15,names[k]);
        World.groups.push(g);
      }
    }

    // Camera: look at main tower
    this.resetCam();
    Cam.centreOn(towerPos.q,towerPos.r,0);

    this.updateHUD();
    this.blogAdd(`${this.empireName} rises! Defend your Main Tower!`,'v');
    this.blogAdd('2 groups of 10 troops deployed. End turn to begin.','i');
  },

  resetCam(){
    const tower=World.buildings.find(b=>b.type===B.MAIN_TOWER&&b.faction===World.playerFaction);
    Cam.zoom=1;
    if(tower)Cam.centreOn(tower.q,tower.r,0);
    else{Cam.x=0;Cam.y=0;}
  },

  _loop(ts){
    this.frid=requestAnimationFrame(t=>this._loop(t));
    if(ts-this.lastT<1000/FPS)return;
    this.lastT=ts;
    this.tick+=0.016;
    this._render();
  },

  _render(){
    const gl=GL.gl;
    if(!gl)return;
    const W=this.canvas.width,H=this.canvas.height;
    // Sky background (use CSS dark gradient via clear)
    GL.clear(.04,.06,.10);

    // Build vertex array
    const verts=[];
    for(let r=0;r<GRID_H;r++){
      for(let q=0;q<GRID_W;q++){
        const cell=World.get(q,r);if(!cell)continue;
        const s=Cam.hexToScreen(q,r,cell.z);
        if(!Cam.visible(s.sx,s.sy))continue;

        // Is this hex in move/attack range?
        const inMove=this.moveRange.some(h=>h.q===q&&h.r===r);
        const inAtk =this.attackRange.some(h=>h.q===q&&h.r===r);
        const isSel =(this.selHex&&this.selHex.q===q&&this.selHex.r===r)?1:0;

        buildHexVerts(verts,s.sx,s.sy,cell.z,cell.t,cell.faction>=0?cell.faction:-1,isSel,this.tick);
      }
    }
    if(verts.length)GL.flush(new Float32Array(verts));

    // Overlay (Canvas 2D for text + icons)
    Overlay.clear();

    // Draw move/attack ranges
    if(this.moveRange.length)  Overlay.drawMoveRange(this.moveRange);
    if(this.attackRange.length)Overlay.drawAttackRange(this.attackRange);

    // Draw buildings
    for(const bld of World.buildings){
      const s=Cam.hexToScreen(bld.q,bld.r,0);
      if(Cam.visible(s.sx,s.sy))
        Overlay.drawBuilding(s.sx,s.sy,bld.type,bld.faction,bld.hp,bld.maxHP);
    }

    // Draw groups (sorted back to front)
    const visGroups=World.groups.filter(g=>g.alive&&g.troops>0);
    visGroups.sort((a,b)=>(a.q+a.r)-(b.q+b.r));
    for(const g of visGroups){
      const s=Cam.hexToScreen(g.q,g.r,World.get(g.q,g.r)?.z||0);
      if(Cam.visible(s.sx,s.sy))Overlay.drawGroup(s.sx,s.sy,g);
    }
  },

  onTap(sx,sy){
    const{q,r}=Cam.screenToHex(sx,sy);
    const cell=World.get(q,r);
    if(!cell)return;

    // Check if tap is on a group
    const grp=World.groups.find(g=>g.alive&&g.troops>0&&g.q===q&&g.r===r);

    if(this.selGroup&&this.selGroup.faction===World.playerFaction){
      // If tapping enemy group in attack range → attack
      if(grp&&grp.faction!==World.playerFaction&&this.attackRange.some(h=>h.q===q&&h.r===r)){
        if(!this.selGroup.attacked){
          Combat.resolve(this.selGroup,grp,World.playerFaction);
          this.selGroup.attacked=true;
          this.selGroup.moved=true;
          this.clearSel();
          this.updateHUD();
          this.checkVictory();
          return;
        }else{this.toast('This group already attacked this turn.');return;}
      }
      // If tapping move range → move
      if(this.moveRange.some(h=>h.q===q&&h.r===r)&&!this.selGroup.moved){
        // Check no friendly group already there
        const occ=World.groups.find(g=>g.alive&&g.q===q&&g.r===r&&g.faction===World.playerFaction);
        if(occ){this.toast('Another group is already there.');return;}
        this.selGroup.q=q;this.selGroup.r=r;
        this.selGroup.moved=true;
        // Recalc ranges
        this.moveRange=[];
        this.attackRange=this._getAttackTargets(this.selGroup);
        this.updateGroupInfo(this.selGroup);
        return;
      }
    }

    // Select player group
    if(grp&&grp.faction===World.playerFaction){
      this.selGroup=grp;
      this.selHex={q,r};
      if(!grp.moved){
        this.moveRange=getMoveRange(q,r,3);
      }else{this.moveRange=[];}
      this.attackRange=this._getAttackTargets(grp);
      this.updateGroupInfo(grp);
      return;
    }

    // Tap enemy group — show info
    if(grp&&grp.faction!==World.playerFaction){
      this.selGroup=null;this.moveRange=[];this.attackRange=[];
      document.getElementById('group-info').classList.add('hidden');
      this.showHexInfo(q,r,cell,grp);
      return;
    }

    // Tap empty hex
    this.selGroup=null;this.moveRange=[];this.attackRange=[];
    document.getElementById('group-info').classList.add('hidden');
    this.selHex={q,r};
    this.showHexInfo(q,r,cell,null);
  },

  _getAttackTargets(grp){
    const nbs=hexNeighbours(grp.q,grp.r);
    return nbs.filter(h=>{
      const eg=World.groups.find(g=>g.alive&&g.q===h.q&&g.r===h.r&&g.faction!==grp.faction);
      return !!eg;
    });
  },

  clearSel(){
    this.selGroup=null;this.selHex=null;this.moveRange=[];this.attackRange=[];
    document.getElementById('group-info').classList.add('hidden');
  },

  updateGroupInfo(g){
    document.getElementById('gi-name').textContent=g.name;
    document.getElementById('gi-stats').textContent=`Troops: ${g.troops} · Morale: ${g.morale}%${g.moved?' · (Moved)':''}`;
    document.getElementById('gi-equip').textContent=`Weapon: ${g.weapon} · Armor: ${g.armor}`;
    document.getElementById('group-info').classList.remove('hidden');
  },

  showHexInfo(q,r,cell,grp){
    const bld=World.buildings.find(b=>b.q===q&&b.r===r);
    let body=`<b>Terrain:</b> ${TNAME[cell.t]}<br>`+
      `<b>Elevation:</b> ${cell.z}<br>`+
      `<b>Defence bonus:</b> +${TDEF[cell.t]}%<br>`+
      `<b>Move cost:</b> ${(1/TMOV[cell.t]).toFixed(1)}`;
    if(bld)body+=`<br><b>Building:</b> ${BNAME[bld.type]}`;
    if(grp)body+=`<br><b>Enemy group:</b> ${grp.name} (${grp.troops} troops, ${World.factions[grp.faction]?.name})`;
    document.getElementById('hex-info-name').textContent=`Hex (${q},${r})`;
    document.getElementById('hex-info-body').innerHTML=body;
    document.getElementById('hex-info').classList.remove('hidden');
  },

  endTurn(){
    // Collect from buildings
    for(const bld of World.buildings){
      if(bld.faction===World.playerFaction){
        const cat=BUILD_CATALOG.find(b=>b.id===bld.type);
        if(cat?.troopsPerTurn){
          // Add troops to nearest player group
          const pg=World.groups.filter(g=>g.alive&&g.faction===World.playerFaction&&g.troops>0);
          if(pg.length){
            pg.sort((a,b)=>hexDistance(a.q,a.r,bld.q,bld.r)-hexDistance(b.q,b.r,bld.q,bld.r));
            pg[0].troops+=cat.troopsPerTurn;
            this.blogAdd(`+${cat.troopsPerTurn} troops from ${BNAME[bld.type]} → ${pg[0].name}`,'i');
          }
        }
      }
    }

    // Process deliveries
    World.deliveries=World.deliveries.map(d=>({...d,turns:d.turns-1}));
    const arrived=World.deliveries.filter(d=>d.turns<=0);
    for(const d of arrived){
      const pg=World.groups.filter(g=>g.alive&&g.faction===World.playerFaction&&g.troops>0);
      if(d.stat.atkBonus)  this.blogAdd(`📦 ${d.name} arrived! +${d.stat.atkBonus}% attack for all groups`,'v');
      if(d.stat.defBonus)  this.blogAdd(`📦 ${d.name} arrived! +${d.stat.defBonus}% defence for all groups`,'v');
      if(d.stat.siegeBonus)this.blogAdd(`📦 ${d.name} arrived! +${d.stat.siegeBonus}% siege attack`,'v');
      // Apply globally (simplified — apply to all player groups)
      for(const g of pg){
        if(d.stat.atkBonus) g.atkBonus=(g.atkBonus||0)+d.stat.atkBonus;
        if(d.stat.defBonus) g.defBonus=(g.defBonus||0)+d.stat.defBonus;
        if(d.stat.siegeBonus)g.siegeBonus=(g.siegeBonus||0)+d.stat.siegeBonus;
        if(d.stat.moveMalus)g.moveMalus=(g.moveMalus||0)+d.stat.moveMalus;
        // Update display name
        g.weapon=d.weapon||g.weapon;
        g.armor=d.armor||g.armor;
      }
    }
    World.deliveries=World.deliveries.filter(d=>d.turns>0);

    // AI turns
    for(let f=1;f<World.factions.length;f++){
      if(World.factions[f].alive)AI.runTurn(f);
    }

    // Check AI victories (did all 3 AI towers fall?)
    this._checkAIAlive();

    // Reset group move flags
    for(const g of World.groups){g.moved=false;g.attacked=false;}

    World.turn++;
    this.updateHUD();
    this.checkVictory();
    this.checkGameOver();
    this.blogAdd(`─── Turn ${World.turn} ───`,'i');
    this.toast(`⏳ Turn ${World.turn}`);
  },

  _checkAIAlive(){
    for(let f=1;f<World.factions.length;f++){
      if(!World.factions[f].alive)continue;
      const tower=World.buildings.find(b=>b.type===B.MAIN_TOWER&&b.faction===f);
      if(!tower||tower.hp<=0){
        World.factions[f].alive=false;
        this.blogAdd(`${World.factions[f].name} has been defeated!`,'v');
      }
    }
  },

  checkGameOver(){
    if(World.towerHP<=0){
      cancelAnimationFrame(this.frid);
      document.getElementById('hud').classList.add('hidden');
      document.getElementById('gameover-screen').classList.remove('hidden');
    }
  },

  checkVictory(){
    const aiAlive=World.factions.slice(1).some(f=>f.alive);
    if(!aiAlive){
      cancelAnimationFrame(this.frid);
      document.getElementById('hud').classList.add('hidden');
      document.getElementById('victory-screen').classList.remove('hidden');
    }
  },

  updateHUD(){
    const r=this.playerRes;
    document.getElementById('v-gold').textContent=r.gold;
    document.getElementById('v-food').textContent=r.food;
    document.getElementById('v-prod').textContent=r.prod;
    document.getElementById('v-turn').textContent=World.turn;
    document.getElementById('empire-label').textContent=this.empireName;
    document.getElementById('empire-dot').style.background=this.empireColor;
    // Tower HP
    const pct=Math.max(0,World.towerHP/World.towerMaxHP);
    document.getElementById('v-tower-hp').textContent=World.towerHP;
    document.getElementById('tower-hp-fill').style.width=`${pct*100}%`;
    const col=pct>.6?'linear-gradient(90deg,#2a8a2a,#4ad95c)':pct>.3?'linear-gradient(90deg,#8a7a1a,#f5c842)':'linear-gradient(90deg,#8a1a1a,#d94a4a)';
    document.getElementById('tower-hp-fill').style.background=col;
    // Delivery bar
    if(World.deliveries.length>0){
      const d=World.deliveries[0];
      document.getElementById('delivery-text').textContent=`📦 ${d.name} arriving in ${d.turns} turn${d.turns!==1?'s':''}`;
      document.getElementById('delivery-bar').classList.remove('hidden');
    }else{
      document.getElementById('delivery-bar').classList.add('hidden');
    }
  },

  openBuild(){
    const list=document.getElementById('build-list');list.innerHTML='';
    const hexQ=this.selHex?.q, hexR=this.selHex?.r;
    const cell=hexQ!=null?World.get(hexQ,hexR):null;
    if(!cell||cell.faction!==World.playerFaction||cell.building!==B.NONE){
      list.innerHTML='<div style="color:#888;font-size:12px;padding:12px;text-align:center">Select one of YOUR empty hex tiles first.</div>';
    }else{
      for(const b of BUILD_CATALOG){
        const ok=this.playerRes.gold>=b.gold&&this.playerRes.prod>=b.prod;
        const row=document.createElement('div');
        row.className='bitem'+(ok?'':' bitem-dis');
        row.innerHTML=`<div><div class="bi-name">${b.name}</div><div class="bi-desc">${b.desc}</div></div><div><div class="bi-cost">⚜${b.gold} ⚒${b.prod}</div><div class="bi-time">${b.turns} turn${b.turns!==1?'s':''} to build</div></div>`;
        if(ok){row.addEventListener('click',()=>{
          this.playerRes.gold-=b.gold;this.playerRes.prod-=b.prod;
          cell.building=b.id;cell.faction=World.playerFaction;
          World.buildings.push({q:hexQ,r:hexR,type:b.id,faction:World.playerFaction,hp:b.id===B.MAIN_TOWER?500:200,maxHP:200});
          this.updateHUD();this.toast(`🏗 ${b.name} construction begun!`);
          document.getElementById('build-menu').classList.add('hidden');
        });}
        list.appendChild(row);
      }
    }
    document.getElementById('build-menu').classList.remove('hidden');
  },

  openUpgrade(){
    const list=document.getElementById('upgrade-list');list.innerHTML='';
    const hasForge=World.buildings.some(b=>b.faction===World.playerFaction&&b.type===B.FORGE);
    const hasElite=World.buildings.some(b=>b.faction===World.playerFaction&&b.type===B.ELITE_FORGE);
    for(const u of UPGRADE_CATALOG){
      const reqMet=(u.req===B.NONE)||(u.req===B.FORGE&&hasForge)||(u.req===B.ELITE_FORGE&&hasElite);
      const ok=reqMet&&this.playerRes.gold>=u.gold&&this.playerRes.prod>=u.prod;
      const row=document.createElement('div');
      row.className='bitem'+(ok?'':' bitem-dis');
      const reqText=u.req===B.NONE?'':(u.req===B.FORGE?'Req: Forge':'Req: Elite Forge');
      row.innerHTML=`<div><div class="bi-name">${u.name}</div><div class="bi-desc">${u.desc}${reqText?'<br><i>'+reqText+'</i>':''}</div></div><div><div class="bi-cost">⚜${u.gold} ⚒${u.prod}</div><div class="bi-time">2-turn delivery</div></div>`;
      if(ok){row.addEventListener('click',()=>{
        this.playerRes.gold-=u.gold;this.playerRes.prod-=u.prod;
        World.deliveries.push({...u,turns:2});
        this.updateHUD();this.toast(`⚒ ${u.name} ordered — arrives in 2 turns!`);
        document.getElementById('upgrade-menu').classList.add('hidden');
      });}
      list.appendChild(row);
    }
    document.getElementById('upgrade-menu').classList.remove('hidden');
  },

  openSplit(){
    if(!this.selGroup||this.selGroup.faction!==World.playerFaction){
      this.toast('Select one of your groups first.');return;
    }
    if(this.selGroup.troops<4){this.toast('Need at least 4 troops to split.');return;}
    document.getElementById('split-source-info').textContent=`${this.selGroup.name} has ${this.selGroup.troops} troops`;
    this.setSplitCount(this.splitCount);
    document.getElementById('split-menu').classList.remove('hidden');
  },

  setSplitCount(n){
    this.splitCount=n;
    document.querySelectorAll('.sbtn').forEach(b=>b.classList.remove('active'));
    document.getElementById(`sc-${n}`)?.classList.add('active');
    this._buildSplitSliders(n);
  },

  _buildSplitSliders(n){
    const total=this.selGroup?.troops||0;
    const per=Math.floor(total/n);
    const cont=document.getElementById('split-sliders');cont.innerHTML='';
    for(let i=0;i<n;i++){
      const row=document.createElement('div');row.className='split-slider-row';
      const initVal=i<n-1?per:total-per*(n-1);
      row.innerHTML=`<label>Group ${i+1}</label><input type="range" min="1" max="${total-n+1}" value="${initVal}" data-idx="${i}"><span class="split-slider-val">${initVal} troops</span>`;
      row.querySelector('input').addEventListener('input',e=>{
        e.target.nextElementSibling.textContent=`${e.target.value} troops`;
      });
      cont.appendChild(row);
    }
  },

  confirmSplit(){
    const g=this.selGroup;if(!g)return;
    const sliders=[...document.querySelectorAll('#split-sliders input[type=range]')];
    const counts=sliders.map(s=>parseInt(s.value));
    const total=counts.reduce((a,b)=>a+b,0);
    if(total>g.troops){this.toast('Total exceeds troop count!');return;}
    // Create new groups around the original hex
    const offsets=[[0,1],[1,0],[-1,1],[0,-1]];
    for(let i=0;i<counts.length;i++){
      if(i===0){g.troops=counts[0];g.name=`${g.name}-A`;}
      else{
        const off=offsets[(i-1)%offsets.length];
        const nq=Math.max(0,Math.min(GRID_W-1,g.q+off[0]));
        const nr=Math.max(0,Math.min(GRID_H-1,g.r+off[1]));
        const ng=makeGroup(World.playerFaction,nq,nr,counts[i],`${g.name}-${String.fromCharCode(65+i)}`);
        ng.weapon=g.weapon;ng.armor=g.armor;ng.morale=g.morale;
        ng.moved=g.moved;ng.attacked=g.attacked;
        World.groups.push(ng);
      }
    }
    g.troops=counts[0];
    this.clearSel();
    this.toast(`✂ Split into ${counts.length} groups!`);
    document.getElementById('split-menu').classList.add('hidden');
  },

  toggleMenu(){
    this.menuOpen=!this.menuOpen;
    document.getElementById('game-menu').classList.toggle('hidden',!this.menuOpen);
  },

  goHome(){
    if(this.frid){cancelAnimationFrame(this.frid);this.frid=null;}
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
    document.getElementById('victory-screen').classList.add('hidden');
    document.getElementById('home-screen').classList.remove('hidden');
    this.menuOpen=false;document.getElementById('game-menu').classList.add('hidden');
    HomeAnim.init();
  },

  toast(msg,dur){
    dur=dur||2400;const el=document.getElementById('toast');
    el.textContent=msg;el.classList.remove('hidden');
    clearTimeout(this._tt);
    this._tt=setTimeout(()=>el.classList.add('hidden'),dur);
  },

  blogAdd(msg,cls){
    this.battleLog.unshift({msg,cls});
    if(this.battleLog.length>this.MAX_LOG)this.battleLog.pop();
    const inner=document.getElementById('battle-log-inner');
    inner.innerHTML=this.battleLog
      .map(l=>`<div class="blog-line blog-${l.cls}">${l.msg}</div>`)
      .join('');
  },
};

/* ══════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════ */
window.GAME=GAME;
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>GAME.init());
}else{
  GAME.init();
}

})();
