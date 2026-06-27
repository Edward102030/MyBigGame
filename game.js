/**
 * REALM ENGINE — game.js (full rewrite)
 * - Home screen with animated background
 * - Triangle-mesh terrain (no visible tile blocks)
 * - Realistic terrain blending & lighting
 * - Clear player vs AI faction display
 * - Smooth D-pad, zoom, reset controls
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════ */
  const GRID_W  = 40;
  const GRID_H  = 40;
  const TW      = 88;   // tile width
  const TH      = 44;   // tile height
  const ZS      = 26;   // z scale per elevation unit
  const FPS     = 60;

  const T = { WATER:0, PLAINS:1, FOREST:2, HILLS:3, MOUNTAIN:4, DESERT:5, SNOW:6 };
  const B = { NONE:0, SETTLEMENT:1, FARM:2, MINE:3, BARRACKS:4, TOWER:5, CAPITAL:6, PORT:7 };

  const FACTION_COLORS  = ['#4a90d9','#d94a4a','#4ad95c','#d9c44a','#a04ad9'];
  const FACTION_NAMES   = ['Blue Kingdom','Crimson Empire','Verdant League','Amber Sultanate','Violet Conclave'];
  const FACTION_ADJECTIVE = ['Your','Enemy','Enemy','Enemy','Enemy'];

  /* ═══════════════════════════════════════════
     TERRAIN COLOUR PALETTES
     Each terrain has: top-light, top-mid, top-dark, cliff-left, cliff-right
     Used to blend triangles so no hard edges show
  ═══════════════════════════════════════════ */
  const TERRAIN_PALETTE = [
    // WATER
    { t0:'#1a5a8c', t1:'#1a4a7a', t2:'#123460', cl:'#0e2a50', cr:'#0a1e3a', foam:'#4a9acc' },
    // PLAINS
    { t0:'#7ab54a', t1:'#5a9030', t2:'#3a6818', cl:'#4a7820', cr:'#355810', trim:'#8ac85a' },
    // FOREST
    { t0:'#2a6a1a', t1:'#1e5210', t2:'#143808', cl:'#163808', cr:'#0e2804', trim:'#3a8a2a' },
    // HILLS
    { t0:'#9a8460', t1:'#7a6448', t2:'#5a4830', cl:'#584030', cr:'#3e2c1e', trim:'#b0986a' },
    // MOUNTAIN
    { t0:'#7a7488', t1:'#5e5870', t2:'#423e54', cl:'#363245', cr:'#28243a', trim:'#9a94a8' },
    // DESERT
    { t0:'#d4a84a', t1:'#b88a30', t2:'#9a6e18', cl:'#906018', cr:'#704a10', trim:'#e8c060' },
    // SNOW
    { t0:'#dce8f0', t1:'#c0d4e0', t2:'#a0b8cc', cl:'#90a8bc', cr:'#708898', trim:'#f0f8ff' },
  ];

  /* ═══════════════════════════════════════════
     WORLD DATA
  ═══════════════════════════════════════════ */
  const World = {
    grid: [],
    turn: 1, level: 1, era: 0,
    ERA_NAMES: ['Age of Iron','Medieval Age','Renaissance','Industrial Age'],
    ERA_THRESH: [0,12,28,48],
    resources: [
      {gold:50,food:30,prod:20},
      {gold:40,food:25,prod:15},
      {gold:40,food:25,prod:15},
      {gold:40,food:25,prod:15},
      {gold:40,food:25,prod:15},
    ],
    idx(x,y){ return y*GRID_W+x; },
    get(x,y){
      if(x<0||y<0||x>=GRID_W||y>=GRID_H) return null;
      return this.grid[this.idx(x,y)];
    },
    set(x,y,d){ if(x<0||y<0||x>=GRID_W||y>=GRID_H) return; Object.assign(this.grid[this.idx(x,y)],d); },
    yield(tile){
      const tg=[0,1,0,2,3,1,0], tf=[0,3,2,1,0,1,0], tp=[0,0,1,2,3,0,0];
      const bg=[0,2,0,3,1,2,4,3], bf=[0,1,4,0,0,0,2,1], bp=[0,0,1,3,2,0,2,1];
      return { gold:tg[tile.t]+bg[tile.b], food:tf[tile.t]+bf[tile.b], prod:tp[tile.t]+bp[tile.b] };
    },
    collect(f){
      let g=0,fd=0,p=0;
      for(const t of this.grid) if(t.f===f){ const y=this.yield(t); g+=y.gold; fd+=y.food; p+=y.prod; }
      const r=this.resources[f];
      r.gold=Math.min(r.gold+g,9999);
      r.food=Math.min(r.food+fd,9999);
      r.prod=Math.min(r.prod+p,9999);
    },
    checkEra(){
      let n=0; for(const t of this.grid) if(t.f===1) n++;
      for(let e=this.ERA_THRESH.length-1;e>=0;e--) if(n>=this.ERA_THRESH[e]){ this.era=e; break; }
    },
    serialise(){ return JSON.stringify({grid:this.grid,turn:this.turn,resources:this.resources,level:this.level,era:this.era}); },
    deserialise(j){
      try{ const d=JSON.parse(j); this.grid=d.grid; this.turn=d.turn; this.resources=d.resources; this.level=d.level||1; this.era=d.era||0; return true; }
      catch(e){ return false; }
    },
  };

  /* ═══════════════════════════════════════════
     WORLD GENERATION
  ═══════════════════════════════════════════ */
  function noise(x,y,s){
    return (Math.sin(x*0.31+s)*Math.cos(y*0.29+s*1.4)+
            Math.sin(x*0.67+s*0.6)*0.55+
            Math.cos(y*0.19+s*2.1)*0.35+1.9)/3.8;
  }

  function generateWorld(){
    World.grid=[];
    const s=Math.random()*100;
    const s2=Math.random()*100;
    for(let gy=0;gy<GRID_H;gy++){
      for(let gx=0;gx<GRID_W;gx++){
        const h=noise(gx,gy,s);
        const m=noise(gx*1.8,gy*1.8,s2);
        const warm=gx/GRID_W;
        let t,z;
        if(h<0.17)        { t=T.WATER;    z=0; }
        else if(h<0.33)   { t=T.PLAINS;   z=0; }
        else if(h<0.52)   { t=m>0.55?T.FOREST:T.PLAINS; z=1; }
        else if(h<0.68)   { t=T.HILLS;    z=1; }
        else if(h<0.84)   { t=T.MOUNTAIN; z=2; }
        else               { t=T.MOUNTAIN; z=3; }
        if(warm>0.62&&gy<GRID_H*0.4&&h>0.22&&h<0.62){ t=T.DESERT; z=Math.min(z,1); }
        if(t===T.MOUNTAIN&&z>=2&&m>0.48) t=T.SNOW;
        World.grid.push({t,z,b:B.NONE,f:0,u:0,uf:0,cd:0});
      }
    }
    placeCapital(0, Math.floor(GRID_W*0.18), Math.floor(GRID_H*0.18));
    placeCapital(1, Math.floor(GRID_W*0.78), Math.floor(GRID_H*0.18));
    placeCapital(2, Math.floor(GRID_W*0.18), Math.floor(GRID_H*0.78));
    placeCapital(3, Math.floor(GRID_W*0.78), Math.floor(GRID_H*0.78));
    placeCapital(4, Math.floor(GRID_W*0.50), Math.floor(GRID_H*0.50));
  }

  function placeCapital(faction,cx,cy){
    for(let r=0;r<10;r++){
      for(let dy=-r;dy<=r;dy++){
        for(let dx=-r;dx<=r;dx++){
          const tile=World.get(cx+dx,cy+dy);
          if(tile&&tile.t!==T.WATER&&tile.t!==T.MOUNTAIN){
            tile.t=T.PLAINS; tile.z=0; tile.b=B.CAPITAL; tile.f=faction+1;
            for(let sy=-2;sy<=2;sy++) for(let sx=-2;sx<=2;sx++){
              const s=World.get(cx+dx+sx,cy+dy+sy);
              if(s&&s.t!==T.WATER) s.f=faction+1;
            }
            tile.u=6; tile.uf=faction+1;
            return;
          }
        }
      }
    }
  }

  /* ═══════════════════════════════════════════
     CAMERA
  ═══════════════════════════════════════════ */
  const Camera = {
    panX:0, panY:0, zoom:1.0,
    minZoom:0.3, maxZoom:2.4,
    toScreen(gx,gy,gz){
      gz=gz||0;
      const ix=(gx-gy)*(TW/2)*0.866;
      const iy=(gx+gy)*(TH/2)*0.5 - gz*ZS;
      const cx=REALM.canvas.width/2, cy=REALM.canvas.height/2;
      return { x:ix*this.zoom+this.panX+cx, y:iy*this.zoom+this.panY+cy };
    },
    fromScreen(sx,sy){
      const cx=REALM.canvas.width/2, cy=REALM.canvas.height/2;
      const rx=(sx-this.panX-cx)/this.zoom;
      const ry=(sy-this.panY-cy)/this.zoom;
      const gx=(rx/(TW*0.866/2)+ry/(TH*0.5/2))/2;
      const gy=(ry/(TH*0.5/2)-rx/(TW*0.866/2))/2;
      return { gx:Math.round(gx), gy:Math.round(gy) };
    },
    isVisible(sx,sy){
      const pad=TW*this.zoom*2.5;
      return sx>-pad&&sx<REALM.canvas.width+pad&&sy>-pad&&sy<REALM.canvas.height+pad;
    },
    centreOn(gx,gy){
      const s=this.toScreen(gx,gy,0);
      this.panX+=(REALM.canvas.width/2)-s.x;
      this.panY+=(REALM.canvas.height/2)-s.y;
    },
  };

  /* ═══════════════════════════════════════════
     RENDERER — Triangle mesh, no visible blocks
  ═══════════════════════════════════════════ */
  const Renderer = {
    ctx: null,
    t: 0,   // animation tick

    init(ctx){ this.ctx=ctx; },

    render(){
      const ctx=this.ctx;
      const W=REALM.canvas.width, H=REALM.canvas.height;
      this.t+=0.016;

      // Sky gradient — deep atmospheric
      const sky=ctx.createLinearGradient(0,0,0,H);
      sky.addColorStop(0,'#0a0e1a');
      sky.addColorStop(0.4,'#0e1828');
      sky.addColorStop(1,'#1a2a3a');
      ctx.fillStyle=sky;
      ctx.fillRect(0,0,W,H);

      // Distant fog/haze at horizon
      const fog=ctx.createLinearGradient(0,H*0.3,0,H*0.55);
      fog.addColorStop(0,'rgba(40,60,80,0)');
      fog.addColorStop(1,'rgba(20,35,50,0.35)');
      ctx.fillStyle=fog;
      ctx.fillRect(0,0,W,H);

      // Build visible tile list sorted back-to-front
      const visible=[];
      for(let gy=0;gy<GRID_H;gy++){
        for(let gx=0;gx<GRID_W;gx++){
          const tile=World.get(gx,gy);
          const s=Camera.toScreen(gx,gy,tile.z);
          if(Camera.isVisible(s.x,s.y)) visible.push({gx,gy,tile,sx:s.x,sy:s.y});
        }
      }
      visible.sort((a,b)=>(a.gx+a.gy)-(b.gx+b.gy)||a.gy-b.gy);

      // Draw terrain tiles
      for(const v of visible) this.drawTile(v.gx,v.gy,v.tile,v.sx,v.sy);

      // Draw buildings + units on top
      for(const v of visible){
        if(v.tile.b!==B.NONE) this.drawBuilding(v.tile,v.sx,v.sy);
        if(v.tile.u>0)        this.drawUnit(v.tile,v.sx,v.sy);
      }

      // Selection ring
      if(REALM.sel.gx!==null){
        const tile=World.get(REALM.sel.gx,REALM.sel.gy);
        if(tile){
          const s=Camera.toScreen(REALM.sel.gx,REALM.sel.gy,tile.z);
          this.drawSelRing(s.x,s.y);
        }
      }
    },

    /* ── Draw one tile using triangle mesh for smooth look ── */
    drawTile(gx,gy,tile,sx,sy){
      const ctx=this.ctx;
      const z=Camera.zoom;
      const hw=(TW/2)*z, hh=(TH/2)*z;
      const cht=tile.z*ZS*z;
      const pal=TERRAIN_PALETTE[tile.t];
      const isWater=tile.t===T.WATER;

      // Water animation offset
      const woff=isWater ? Math.sin(this.t*1.1+gx*0.6+gy*0.5)*1.8 : 0;

      // The 5 vertices of the tile top face + sub-divided centre
      // Top face split into 4 triangles via centre point → smooth colour variation
      const cx=sx,    cy=sy+woff;
      const tN={x:sx,       y:sy-hh*0+woff};       // north apex
      const tE={x:sx+hw,    y:sy+hh+woff};          // east
      const tS={x:sx,       y:sy+hh*2+woff};        // south
      const tW={x:sx-hw,    y:sy+hh+woff};          // west
      const tC={x:sx,       y:sy+hh+woff};          // centre

      // Determine lighting: north-west faces lighter, south-east darker
      const lightMod=Math.sin(this.t*0.3+gx*0.1)*0.04; // subtle shimmer

      if(isWater){
        // Water — animated gradient quads
        const wg=ctx.createLinearGradient(sx-hw,sy,sx+hw,sy+hh*2);
        wg.addColorStop(0,   this.lerpColor(pal.t0,pal.t1,0.3+lightMod));
        wg.addColorStop(0.5, pal.t1);
        wg.addColorStop(1,   pal.t2);
        ctx.fillStyle=wg;
        ctx.beginPath();
        ctx.moveTo(tN.x,tN.y); ctx.lineTo(tE.x,tE.y);
        ctx.lineTo(tS.x,tS.y); ctx.lineTo(tW.x,tW.y);
        ctx.closePath(); ctx.fill();

        // Foam lines on water surface
        if(z>0.5){
          ctx.strokeStyle=`rgba(180,220,255,${0.12+Math.sin(this.t+gx+gy)*0.06})`;
          ctx.lineWidth=0.8*z;
          ctx.beginPath();
          const fl=Math.sin(this.t*0.8+gx*0.7)*hw*0.3;
          ctx.moveTo(sx-hw*0.4+fl,sy+hh*0.8+woff);
          ctx.lineTo(sx+hw*0.4+fl,sy+hh*0.8+woff);
          ctx.stroke();
        }
      } else {
        // Land tiles — 4 triangles with slight colour variation → no hard block look
        // NW triangle (lighter — sun side)
        this.tri(ctx, tN,tC,tW, this.shadeColor(pal.t0,  8+lightMod*100));
        // NE triangle
        this.tri(ctx, tN,tE,tC, this.shadeColor(pal.t1,  2+lightMod*60));
        // SE triangle (darker — shadow side)
        this.tri(ctx, tC,tE,tS, this.shadeColor(pal.t2, -4));
        // SW triangle
        this.tri(ctx, tW,tC,tS, this.shadeColor(pal.t1, -8));
      }

      // Elevation cliffs — left and right faces
      if(tile.z>0&&!isWater){
        // Left cliff face (south-west)
        ctx.beginPath();
        ctx.moveTo(tW.x, tW.y); ctx.lineTo(tS.x, tS.y);
        ctx.lineTo(tS.x, tS.y+cht); ctx.lineTo(tW.x, tW.y+cht);
        ctx.closePath();
        const lg=ctx.createLinearGradient(tW.x,tW.y,tW.x,tW.y+cht);
        lg.addColorStop(0,pal.cl); lg.addColorStop(1,this.shadeColor(pal.cl,-25));
        ctx.fillStyle=lg; ctx.fill();

        // Right cliff face (south-east)
        ctx.beginPath();
        ctx.moveTo(tE.x, tE.y); ctx.lineTo(tS.x, tS.y);
        ctx.lineTo(tS.x, tS.y+cht); ctx.lineTo(tE.x, tE.y+cht);
        ctx.closePath();
        const rg=ctx.createLinearGradient(tE.x,tE.y,tE.x,tE.y+cht);
        rg.addColorStop(0,pal.cr); rg.addColorStop(1,this.shadeColor(pal.cr,-30));
        ctx.fillStyle=rg; ctx.fill();

        // Thin edge highlight at top of cliff
        ctx.strokeStyle=this.hexAlpha(pal.trim||pal.t0,0.3);
        ctx.lineWidth=0.7;
        ctx.beginPath();
        ctx.moveTo(tW.x,tW.y); ctx.lineTo(tS.x,tS.y); ctx.lineTo(tE.x,tE.y);
        ctx.stroke();
      }

      // Faction territory tint — subtle coloured wash
      if(tile.f>0&&!isWater){
        const fc=FACTION_COLORS[tile.f-1];
        const isPlayer=(tile.f===1);
        ctx.beginPath();
        ctx.moveTo(tN.x,tN.y); ctx.lineTo(tE.x,tE.y);
        ctx.lineTo(tS.x,tS.y); ctx.lineTo(tW.x,tW.y);
        ctx.closePath();
        ctx.fillStyle=this.hexAlpha(fc, isPlayer?0.14:0.1);
        ctx.fill();
        // Border line
        ctx.strokeStyle=this.hexAlpha(fc, isPlayer?0.7:0.45);
        ctx.lineWidth=isPlayer?1.6:0.9;
        ctx.stroke();
      }

      // Natural features (trees, rocks etc) drawn on plain tiles
      if(tile.b===B.NONE&&!isWater&&z>0.45){
        this.drawNature(tile,sx,sy,z,cht);
      }
    },

    tri(ctx,a,b,c,color){
      ctx.beginPath();
      ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(c.x,c.y);
      ctx.closePath();
      ctx.fillStyle=color; ctx.fill();
    },

    /* ── Natural decorations ── */
    drawNature(tile,sx,sy,z,cht){
      const ctx=this.ctx;
      const hw=(TW/2)*z, hh=(TH/2)*z;
      const bx=sx, by=sy+hh-cht;

      switch(tile.t){
        case T.FOREST:{
          // 2-3 pine trees per tile
          const trees=[[-.22,-.1,1],[.18,-.05,.78],[-.04,.12,.6]];
          for(const [ox,oy,sc] of trees){
            const tx=bx+ox*hw, ty=by+oy*hh;
            const h=hh*0.75*sc*z, w=hw*0.22*sc*z;
            // Trunk
            ctx.fillStyle='#5a3a18';
            ctx.fillRect(tx-1.5*z,ty,3*z,h*0.28);
            // Three layered triangles — pine shape
            const layers=[[0,0,1],[0.15,.28,.78],[0.28,.52,.6]];
            for(const [ly,lh,ls] of layers){
              ctx.fillStyle=ly===0?'#2a6a18':ly===1?'#1e5210':'#163808';
              ctx.beginPath();
              ctx.moveTo(tx, ty-h*(1-ly));
              ctx.lineTo(tx+w*ls, ty-h*(lh));
              ctx.lineTo(tx-w*ls, ty-h*(lh));
              ctx.closePath(); ctx.fill();
            }
          }
          break;
        }
        case T.HILLS:{
          // Rolling hill bump
          const g=ctx.createRadialGradient(bx,by,0,bx,by,hw*0.55);
          g.addColorStop(0,TERRAIN_PALETTE[T.HILLS].trim||'#b09870');
          g.addColorStop(1,'rgba(0,0,0,0)');
          ctx.fillStyle=g;
          ctx.beginPath();
          ctx.ellipse(bx,by-hh*0.15,hw*0.42,hh*0.38,0,0,Math.PI*2);
          ctx.fill();
          break;
        }
        case T.MOUNTAIN:
        case T.SNOW:{
          const pal=TERRAIN_PALETTE[tile.t];
          // Main peak
          ctx.fillStyle=pal.t1;
          ctx.beginPath();
          ctx.moveTo(bx, by-hh*1.1);
          ctx.lineTo(bx+hw*0.42, by-hh*0.12);
          ctx.lineTo(bx-hw*0.42, by-hh*0.12);
          ctx.closePath(); ctx.fill();
          // Snow cap
          ctx.fillStyle='#dce8f4';
          ctx.beginPath();
          ctx.moveTo(bx, by-hh*1.1);
          ctx.lineTo(bx+hw*0.16, by-hh*0.62);
          ctx.lineTo(bx-hw*0.16, by-hh*0.62);
          ctx.closePath(); ctx.fill();
          // Secondary smaller peak
          ctx.fillStyle=pal.t2;
          ctx.beginPath();
          ctx.moveTo(bx+hw*0.28, by-hh*0.68);
          ctx.lineTo(bx+hw*0.52, by-hh*0.12);
          ctx.lineTo(bx+hw*0.05, by-hh*0.12);
          ctx.closePath(); ctx.fill();
          break;
        }
        case T.DESERT:{
          if(Math.random()>0.7&&z>0.6){
            // Cactus
            ctx.strokeStyle='#5a8020'; ctx.lineWidth=3*z;
            ctx.beginPath();
            ctx.moveTo(bx,by); ctx.lineTo(bx,by-hh*0.6);
            ctx.moveTo(bx,by-hh*0.38);
            ctx.lineTo(bx+hw*0.22,by-hh*0.38);
            ctx.lineTo(bx+hw*0.22,by-hh*0.5);
            ctx.stroke();
          }
          break;
        }
      }
    },

    /* ── Buildings ── */
    drawBuilding(tile,sx,sy){
      const ctx=this.ctx;
      const z=Camera.zoom;
      const hw=(TW/2)*z, hh=(TH/2)*z;
      const cht=tile.z*ZS*z;
      const bx=sx, by=sy+hh-cht;
      const fc=tile.f>0?FACTION_COLORS[tile.f-1]:'#aaaaaa';
      const isPlayer=(tile.f===1);

      switch(tile.b){
        case B.CAPITAL:   this.bldCapital(ctx,bx,by,hw,hh,fc,z,isPlayer); break;
        case B.SETTLEMENT:this.bldSettlement(ctx,bx,by,hw,hh,fc,z); break;
        case B.FARM:      this.bldFarm(ctx,bx,by,hw,hh,fc,z); break;
        case B.MINE:      this.bldMine(ctx,bx,by,hw,hh,fc,z); break;
        case B.BARRACKS:  this.bldBarracks(ctx,bx,by,hw,hh,fc,z); break;
        case B.TOWER:     this.bldTower(ctx,bx,by,hw,hh,fc,z); break;
        case B.PORT:      this.bldPort(ctx,bx,by,hw,hh,fc,z); break;
      }
    },

    bldCapital(ctx,cx,cy,hw,hh,fc,z,isPlayer){
      // Stone base platform
      this.isoBox(ctx,cx,cy,hw*.55,hh*.22,hh*.18,z,'#5a4a30','#3a2e1c','#2a2016');
      // Main keep
      this.isoBox(ctx,cx,cy-hh*.18,hw*.4,hh*.2,hh*.6,z,'#8a7a5a','#6a5a3a','#4a3e28');
      // Left tower
      this.isoBox(ctx,cx-hw*.3,cy-hh*.08,hw*.14,hh*.1,hh*.75,z,'#9a8a6a','#7a6a4a','#5a4a30');
      // Right tower
      this.isoBox(ctx,cx+hw*.3,cy-hh*.08,hw*.14,hh*.1,hh*.75,z,'#9a8a6a','#7a6a4a','#5a4a30');
      // Conical tower tops
      this.cone(ctx,cx-hw*.3,cy-hh*.83,hw*.18,hh*.3,fc);
      this.cone(ctx,cx+hw*.3,cy-hh*.83,hw*.18,hh*.3,fc);
      // Banner pole + flag
      ctx.strokeStyle='#8a6a30'; ctx.lineWidth=2*z;
      ctx.beginPath(); ctx.moveTo(cx,cy-hh*.78); ctx.lineTo(cx,cy-hh*1.3); ctx.stroke();
      ctx.fillStyle=fc;
      ctx.beginPath();
      ctx.moveTo(cx,cy-hh*1.3); ctx.lineTo(cx+hw*.2,cy-hh*1.18); ctx.lineTo(cx,cy-hh*1.06);
      ctx.closePath(); ctx.fill();
      // Player glow ring
      if(isPlayer){
        ctx.strokeStyle=this.hexAlpha(fc,0.6+Math.sin(this.t*2)*0.2);
        ctx.lineWidth=2.5*z;
        ctx.beginPath();
        ctx.ellipse(cx,cy+hh*.1,hw*.5,hh*.25,0,0,Math.PI*2);
        ctx.stroke();
      }
      // Label
      if(z>0.6){
        ctx.fillStyle='#fff'; ctx.font=`bold ${Math.max(9,11*z)}px Courier New`;
        ctx.textAlign='center';
        ctx.fillText(isPlayer?'★':'⚑',cx,cy-hh*1.42);
      }
    },

    bldSettlement(ctx,cx,cy,hw,hh,fc,z){
      this.isoBox(ctx,cx-hw*.1,cy,hw*.28,hh*.16,hh*.38,z,'#8a7050','#6a5038','#4a3820');
      this.cone(ctx,cx-hw*.1,cy-hh*.38,hw*.3,hh*.24,fc);
      this.isoBox(ctx,cx+hw*.25,cy+hh*.06,hw*.18,hh*.12,hh*.28,z,'#7a6040','#5a4228','#3a2c18');
      this.cone(ctx,cx+hw*.25,cy-hh*.22,hw*.2,hh*.18,this.shadeColor(fc,15));
    },

    bldFarm(ctx,cx,cy,hw,hh,fc,z){
      // Field rows
      for(let i=0;i<4;i++){
        const off=(i-1.5)*hh*.22;
        ctx.strokeStyle=i%2===0?'#7a6a20':'#5a8a28';
        ctx.lineWidth=2.2*z;
        ctx.beginPath();
        ctx.moveTo(cx-hw*.5,cy+off); ctx.lineTo(cx+hw*.5,cy+off);
        ctx.stroke();
      }
      this.isoBox(ctx,cx-hw*.2,cy-hh*.05,hw*.22,hh*.14,hh*.42,z,'#9a3a18','#6a2210','#4a1808');
      this.cone(ctx,cx-hw*.2,cy-hh*.47,hw*.24,hh*.2,'#5a1808');
    },

    bldMine(ctx,cx,cy,hw,hh,fc,z){
      this.isoBox(ctx,cx,cy,hw*.35,hh*.18,hh*.3,z,'#4a4040','#2a2828','#1a1818');
      ctx.fillStyle='#111';
      ctx.beginPath(); ctx.arc(cx,cy-hh*.18,hw*.16,Math.PI,0); ctx.fill();
      ctx.strokeStyle='#8a6a28'; ctx.lineWidth=2.5*z;
      ctx.beginPath();
      ctx.moveTo(cx-hw*.22,cy); ctx.lineTo(cx-hw*.22,cy-hh*.42);
      ctx.moveTo(cx+hw*.22,cy); ctx.lineTo(cx+hw*.22,cy-hh*.42);
      ctx.moveTo(cx-hw*.22,cy-hh*.38); ctx.lineTo(cx+hw*.22,cy-hh*.38);
      ctx.stroke();
      if(z>0.55){ ctx.fillStyle='#f5c842'; ctx.font=`${Math.max(9,10*z)}px sans-serif`; ctx.textAlign='center'; ctx.fillText('⛏',cx,cy-hh*.5); }
    },

    bldBarracks(ctx,cx,cy,hw,hh,fc,z){
      this.isoBox(ctx,cx,cy,hw*.44,hh*.2,hh*.42,z,'#5a4a30','#3a3020','#282010');
      const bw=hw*.12, bh=hh*.12;
      ctx.fillStyle='#6a5a40';
      for(let i=-1;i<=1;i++) ctx.fillRect(cx+i*bw*1.8-bw/2,cy-hh*.42-bh,bw,bh);
      ctx.fillStyle='#1a1008';
      ctx.fillRect(cx-bw*.4,cy-hh*.28,bw*.8,hh*.28);
      ctx.fillStyle=fc;
      ctx.fillRect(cx-1,cy-hh*.52,2,hh*.12);
      ctx.beginPath(); ctx.moveTo(cx+1,cy-hh*.52); ctx.lineTo(cx+hw*.15,cy-hh*.44); ctx.lineTo(cx+1,cy-hh*.36); ctx.closePath(); ctx.fill();
    },

    bldTower(ctx,cx,cy,hw,hh,fc,z){
      this.isoBox(ctx,cx,cy,hw*.18,hh*.1,hh*.95,z,'#8a8080','#6a6060','#4a4040');
      this.isoBox(ctx,cx,cy-hh*.95,hw*.24,hh*.12,hh*.2,z,'#9a9088','#7a7068','#5a5048');
      for(let i=-1;i<=1;i++) ctx.fillRect(cx+i*hw*.16-hw*.07,cy-hh*1.17,hw*.1,hh*.1);
      ctx.fillStyle=fc;
      ctx.fillRect(cx,cy-hh*1.28,2*z,hh*.2);
      ctx.beginPath(); ctx.moveTo(cx+2*z,cy-hh*1.28); ctx.lineTo(cx+hw*.18,cy-hh*1.18); ctx.lineTo(cx+2*z,cy-hh*1.08); ctx.closePath(); ctx.fill();
    },

    bldPort(ctx,cx,cy,hw,hh,fc,z){
      for(let i=-2;i<=2;i++) { ctx.fillStyle='#6a4a28'; ctx.fillRect(cx+i*hw*.14-1.5,cy-hh*.05,3,hh*.2); }
      ctx.fillStyle='#7a5020';
      ctx.beginPath(); ctx.ellipse(cx,cy-hh*.15,hw*.38,hh*.15,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#e8d5a3';
      ctx.beginPath(); ctx.moveTo(cx,cy-hh*.6); ctx.lineTo(cx+hw*.25,cy-hh*.28); ctx.lineTo(cx,cy-hh*.15); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#8a5a28'; ctx.lineWidth=2*z;
      ctx.beginPath(); ctx.moveTo(cx,cy-hh*.65); ctx.lineTo(cx,cy-hh*.12); ctx.stroke();
    },

    /* ── Unit marker ── */
    drawUnit(tile,sx,sy){
      const ctx=this.ctx;
      const z=Camera.zoom;
      const hh=(TH/2)*z;
      const cht=tile.z*ZS*z;
      const cx=sx, cy=sy+hh*0.55-cht;
      const fc=tile.uf>0?FACTION_COLORS[tile.uf-1]:'#aaa';
      const isPlayer=(tile.uf===1);
      const r=isPlayer?12*z:10*z;

      // Drop shadow
      ctx.beginPath(); ctx.ellipse(cx,cy+r*.4,r*.7,r*.25,0,0,Math.PI*2);
      ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill();

      // Unit circle
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
      const ug=ctx.createRadialGradient(cx-r*.3,cy-r*.3,r*.1,cx,cy,r);
      ug.addColorStop(0,this.shadeColor(fc,30));
      ug.addColorStop(1,fc);
      ctx.fillStyle=ug; ctx.fill();

      // Ring — player gets a bright gold ring
      ctx.strokeStyle=isPlayer?'#f5c842':'rgba(255,255,255,0.7)';
      ctx.lineWidth=isPlayer?2.5:1.5;
      ctx.stroke();

      // Strength number
      ctx.fillStyle='#fff';
      ctx.font=`bold ${Math.max(8,isPlayer?10*z:8*z)}px Courier New`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(tile.u,cx,cy);
      ctx.textBaseline='alphabetic';

      // Player crown icon above unit
      if(isPlayer&&z>0.55){
        ctx.font=`${Math.max(7,8*z)}px sans-serif`;
        ctx.fillStyle='#f5c842';
        ctx.fillText('♔',cx,cy-r-2*z);
      }
    },

    /* ── Selection ring ── */
    drawSelRing(sx,sy){
      const ctx=this.ctx;
      const z=Camera.zoom;
      const hw=(TW/2)*z, hh=(TH/2)*z;
      const alpha=0.5+Math.sin(this.t*3)*0.35;
      ctx.beginPath();
      ctx.moveTo(sx,sy); ctx.lineTo(sx+hw,sy+hh);
      ctx.lineTo(sx,sy+hh*2); ctx.lineTo(sx-hw,sy+hh);
      ctx.closePath();
      ctx.strokeStyle=`rgba(245,200,66,${alpha})`;
      ctx.lineWidth=2.5; ctx.stroke();
    },

    /* ── Helpers ── */
    isoBox(ctx,cx,cy,hw,hh,height,z,topC,leftC,rightC){
      // Top face
      ctx.beginPath();
      ctx.moveTo(cx,cy-hh); ctx.lineTo(cx+hw,cy); ctx.lineTo(cx,cy+hh); ctx.lineTo(cx-hw,cy);
      ctx.closePath(); ctx.fillStyle=topC; ctx.fill();
      // Left face
      ctx.beginPath();
      ctx.moveTo(cx-hw,cy); ctx.lineTo(cx,cy+hh); ctx.lineTo(cx,cy+hh+height); ctx.lineTo(cx-hw,cy+height);
      ctx.closePath(); ctx.fillStyle=leftC; ctx.fill();
      // Right face
      ctx.beginPath();
      ctx.moveTo(cx+hw,cy); ctx.lineTo(cx,cy+hh); ctx.lineTo(cx,cy+hh+height); ctx.lineTo(cx+hw,cy+height);
      ctx.closePath(); ctx.fillStyle=rightC; ctx.fill();
    },

    cone(ctx,cx,cy,hw,h,color){
      ctx.fillStyle=color;
      ctx.beginPath(); ctx.moveTo(cx,cy-h); ctx.lineTo(cx+hw,cy); ctx.lineTo(cx-hw,cy); ctx.closePath(); ctx.fill();
      ctx.fillStyle=this.shadeColor(color,-20);
      ctx.beginPath(); ctx.moveTo(cx,cy-h); ctx.lineTo(cx+hw,cy); ctx.lineTo(cx,cy-h*.15); ctx.closePath(); ctx.fill();
    },

    hexAlpha(hex,a){
      const n=parseInt(hex.replace('#',''),16);
      return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
    },
    shadeColor(hex,pct){
      try{
        const n=parseInt(hex.replace('#',''),16);
        const f=1+pct/100;
        const r=Math.min(255,Math.max(0,Math.floor(((n>>16)&255)*f)));
        const g=Math.min(255,Math.max(0,Math.floor(((n>>8)&255)*f)));
        const b=Math.min(255,Math.max(0,Math.floor((n&255)*f)));
        return `rgb(${r},${g},${b})`;
      }catch{ return hex; }
    },
    lerpColor(a,b,t){
      const an=parseInt(a.replace('#',''),16), bn=parseInt(b.replace('#',''),16);
      const r=Math.round(((an>>16)&255)*(1-t)+(((bn>>16)&255)*t));
      const g=Math.round(((an>>8)&255)*(1-t)+(((bn>>8)&255)*t));
      const bl=Math.round((an&255)*(1-t)+((bn&255)*t));
      return `rgb(${r},${g},${bl})`;
    },
  };

  /* ═══════════════════════════════════════════
     AI
  ═══════════════════════════════════════════ */
  const AI = {
    process(faction){
      const res=World.resources[faction];
      const owned=[], border=new Map();
      for(let gy=0;gy<GRID_H;gy++) for(let gx=0;gx<GRID_W;gx++){
        const t=World.get(gx,gy); if(!t) continue;
        if(t.f===faction){
          owned.push({gx,gy,tile:t});
          for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){
            const nb=World.get(gx+dx,gy+dy);
            if(nb&&nb.f!==faction&&nb.t!==T.WATER) border.set(`${gx+dx},${gy+dy}`,{gx:gx+dx,gy:gy+dy,tile:nb});
          }
        }
      }
      if(!owned.length) return;

      // Expand
      for(const [,b] of border){ if(b.tile.f===0){ World.set(b.gx,b.gy,{f:faction}); break; } }

      // Build
      const can=(g,p)=>res.gold>=g&&res.prod>=p;
      for(const {gx,gy,tile} of owned){
        if(tile.b!==B.NONE||tile.t===T.WATER) continue;
        if(res.food<35&&tile.t===T.PLAINS&&can(20,5)){ World.set(gx,gy,{b:B.FARM}); res.gold-=20; res.prod-=5; break; }
        if(res.prod<30&&tile.t===T.HILLS&&can(30,10)){ World.set(gx,gy,{b:B.MINE}); res.gold-=30; res.prod-=10; break; }
        if(owned.length>4&&can(40,15)){ World.set(gx,gy,{b:B.BARRACKS}); res.gold-=40; res.prod-=15; break; }
        if(owned.length<5&&can(15,5)){ World.set(gx,gy,{b:B.SETTLEMENT}); res.gold-=15; res.prod-=5; break; }
      }

      // Train
      for(const {gx,gy,tile} of owned){
        if(tile.b===B.BARRACKS&&tile.u<8&&can(20,10)){ World.set(gx,gy,{u:tile.u+2,uf:faction}); res.gold-=20; res.prod-=10; break; }
      }

      // Attack
      for(const {gx,gy,tile} of owned){
        if(tile.u<=0) continue;
        for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){
          const nb=World.get(gx+dx,gy+dy);
          if(nb&&nb.f>0&&nb.f!==faction){ Combat.resolve(gx,gy,gx+dx,gy+dy); break; }
        }
      }
    },
  };

  /* ═══════════════════════════════════════════
     COMBAT
  ═══════════════════════════════════════════ */
  const Combat = {
    log:[],
    resolve(ax,ay,dx,dy){
      const att=World.get(ax,ay), def=World.get(dx,dy);
      if(!att||!def||att.u<=0) return;
      const td=[0,0,1,2,3,0,1], bd=[0,1,0,0,2,3,2,1];
      const as=att.u, ds=def.u+td[def.t]+bd[def.b];
      const ar=as*(0.6+Math.random()*.8), dr=ds*(0.5+Math.random()*.7);
      const al=Math.ceil(dr*.3), dl=Math.ceil(ar*.4);
      World.set(ax,ay,{u:Math.max(0,att.u-al)});
      const af=att.uf||att.f, df=def.uf||def.f;
      if(Math.max(0,def.u-dl)<=0){
        const mv=Math.max(1,Math.floor(Math.max(0,att.u-al)/2));
        World.set(dx,dy,{f:af,u:mv,uf:af,b:def.b});
        World.set(ax,ay,{u:Math.max(0,att.u-al-mv)});
        this.log.push({msg:`${FACTION_NAMES[af-1]} conquered a tile from ${FACTION_NAMES[df-1]}`,cls:'victory'});
      } else {
        World.set(dx,dy,{u:Math.max(0,def.u-dl)});
        this.log.push({msg:`${FACTION_NAMES[af-1]} attacked ${FACTION_NAMES[df-1]} — Atk-${al} Def-${dl}`,cls:'neutral'});
      }
    },
    showLog(){
      if(!this.log.length) return;
      const body=document.getElementById('combat-log-body');
      const el=document.getElementById('combat-log');
      body.innerHTML=this.log.map(l=>`<div class="combat-log-line ${l.cls}">${l.msg}</div>`).join('');
      el.classList.remove('hidden');
      this.log=[];
    },
  };

  /* ═══════════════════════════════════════════
     BUILDINGS DATA
  ═══════════════════════════════════════════ */
  const BUILDINGS=[
    {id:B.SETTLEMENT,name:'Settlement', goldCost:15,prodCost:5,  validOn:[T.PLAINS,T.DESERT], desc:'+2⚜ +1🌾'},
    {id:B.FARM,      name:'Farm',       goldCost:20,prodCost:5,  validOn:[T.PLAINS],           desc:'+4🌾'},
    {id:B.MINE,      name:'Mine',       goldCost:30,prodCost:10, validOn:[T.HILLS,T.MOUNTAIN], desc:'+3⚒'},
    {id:B.BARRACKS,  name:'Barracks',   goldCost:40,prodCost:15, validOn:[T.PLAINS,T.HILLS],   desc:'Train units'},
    {id:B.TOWER,     name:'Watch Tower',goldCost:35,prodCost:12, validOn:[T.HILLS,T.PLAINS,T.MOUNTAIN], desc:'+3 Defence'},
    {id:B.PORT,      name:'Port',       goldCost:45,prodCost:15, validOn:[T.PLAINS],           desc:'+3⚜ +1⚒'},
  ];

  /* ═══════════════════════════════════════════
     HUD
  ═══════════════════════════════════════════ */
  const HUD={
    els:{},
    toastTimer:null,
    init(){
      ['val-gold','val-food','val-prod','val-turn','val-level',
       'progress-fill','hud-era-label','toast'].forEach(id=>{
        this.els[id]=document.getElementById(id);
      });
    },
    update(){
      const r=World.resources[0];
      this.els['val-gold'].textContent=r.gold;
      this.els['val-food'].textContent=r.food;
      this.els['val-prod'].textContent=r.prod;
      this.els['val-turn'].textContent=World.turn;
      this.els['val-level'].textContent=World.level;
      this.els['hud-era-label'].textContent=World.ERA_NAMES[World.era]||'Age of Iron';
      let owned=0; for(const t of World.grid) if(t.f===1) owned++;
      const cur=World.ERA_THRESH[World.era]||0;
      const nxt=World.ERA_THRESH[World.era+1]||60;
      this.els['progress-fill'].style.width=`${Math.min(100,Math.max(0,(owned-cur)/(nxt-cur)*100))}%`;
      const newLv=Math.floor(World.turn/10)+1;
      if(newLv!==World.level){ World.level=newLv; this.notify(`⚡ Level ${World.level} reached!`); }
    },
    notify(msg,dur){
      dur=dur||2500;
      const t=this.els['toast'];
      t.textContent=msg; t.classList.remove('hidden');
      clearTimeout(this.toastTimer);
      this.toastTimer=setTimeout(()=>t.classList.add('hidden'),dur);
    },
    updateBuildMenu(tile){
      const list=document.getElementById('build-list');
      list.innerHTML='';
      if(!tile){ list.innerHTML='<div style="color:#888;font-size:12px;text-align:center;padding:12px">Select one of your tiles first</div>'; return; }
      if(tile.f!==1){ list.innerHTML='<div style="color:#888;font-size:12px;text-align:center;padding:12px">You do not own this tile</div>'; return; }
      const res=World.resources[0];
      let shown=0;
      for(const b of BUILDINGS){
        if(!b.validOn.includes(tile.t)) continue;
        if(tile.b!==B.NONE) continue;
        shown++;
        const ok=res.gold>=b.goldCost&&res.prod>=b.prodCost;
        const row=document.createElement('div');
        row.className='build-item'+(ok?'':' build-item-disabled');
        row.innerHTML=`<div><div class="build-item-name">${b.name}</div><div class="build-item-cost">⚜${b.goldCost} ⚒${b.prodCost} · ${b.desc}</div></div>`;
        if(ok) row.onclick=()=>{ REALM.buildAt(REALM.sel.gx,REALM.sel.gy,b.id); REALM.closeBuildMenu(); };
        list.appendChild(row);
      }
      if(!shown) list.innerHTML='<div style="color:#888;font-size:12px;text-align:center;padding:12px">No valid buildings for this tile type</div>';
    },
  };

  /* ═══════════════════════════════════════════
     INPUT
  ═══════════════════════════════════════════ */
  const Input={
    drag:false, lx:0, ly:0,
    pinch:false, pd:0,
    tap:null, TAP_D:14, TAP_T:240,

    init(canvas){
      canvas.addEventListener('touchstart', this.ts.bind(this),{passive:false});
      canvas.addEventListener('touchmove',  this.tm.bind(this),{passive:false});
      canvas.addEventListener('touchend',   this.te.bind(this),{passive:false});
      canvas.addEventListener('touchcancel',this.te.bind(this),{passive:false});
      canvas.addEventListener('mousedown',  this.md.bind(this));
      canvas.addEventListener('mousemove',  this.mm.bind(this));
      canvas.addEventListener('mouseup',    this.mu.bind(this));
      canvas.addEventListener('wheel',      this.wh.bind(this),{passive:false});
    },
    pd2(t){ const dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); },
    ts(e){ e.preventDefault();
      if(e.touches.length===2){ this.pinch=true; this.drag=false; this.pd=this.pd2(e.touches); return; }
      const t=e.touches[0]; this.drag=true; this.pinch=false; this.lx=t.clientX; this.ly=t.clientY;
      this.tap={x:t.clientX,y:t.clientY,time:Date.now()};
    },
    tm(e){ e.preventDefault();
      if(this.pinch&&e.touches.length===2){
        const d=this.pd2(e.touches), sc=d/this.pd; this.pd=d;
        const mx=(e.touches[0].clientX+e.touches[1].clientX)/2;
        const my=(e.touches[0].clientY+e.touches[1].clientY)/2;
        this.applyZoom(sc,mx,my); return;
      }
      if(this.drag&&e.touches.length===1){
        const t=e.touches[0];
        Camera.panX+=t.clientX-this.lx; Camera.panY+=t.clientY-this.ly;
        this.lx=t.clientX; this.ly=t.clientY;
        if(this.tap&&Math.hypot(t.clientX-this.tap.x,t.clientY-this.tap.y)>this.TAP_D) this.tap=null;
      }
    },
    te(e){ e.preventDefault(); this.pinch=false;
      if(!e.touches.length){ this.drag=false;
        if(this.tap&&Date.now()-this.tap.time<this.TAP_T) REALM.onTap(this.tap.x,this.tap.y);
        this.tap=null;
      }
    },
    md(e){ this.drag=true; this.lx=e.clientX; this.ly=e.clientY; this.tap={x:e.clientX,y:e.clientY,time:Date.now()}; },
    mm(e){ if(!this.drag) return; Camera.panX+=e.clientX-this.lx; Camera.panY+=e.clientY-this.ly; this.lx=e.clientX; this.ly=e.clientY;
      if(this.tap&&Math.hypot(e.clientX-this.tap.x,e.clientY-this.tap.y)>this.TAP_D) this.tap=null;
    },
    mu(e){ this.drag=false; if(this.tap&&Date.now()-this.tap.time<this.TAP_T) REALM.onTap(this.tap.x,this.tap.y); this.tap=null; },
    wh(e){ e.preventDefault(); this.applyZoom(e.deltaY<0?1.12:0.88,e.clientX,e.clientY); },
    applyZoom(sc,fx,fy){
      const old=Camera.zoom;
      Camera.zoom=Math.max(Camera.minZoom,Math.min(Camera.maxZoom,Camera.zoom*sc));
      const ratio=Camera.zoom/old-1;
      const cx=REALM.canvas.width/2, cy=REALM.canvas.height/2;
      Camera.panX-=(fx-cx-Camera.panX)*ratio;
      Camera.panY-=(fy-cy-Camera.panY)*ratio;
    },
  };

  /* ═══════════════════════════════════════════
     CAMERA CONTROLS (D-pad / zoom / reset)
  ═══════════════════════════════════════════ */
  const CameraControls={
    STEP:75, _held:null,
    init(){
      const b=(id,fn)=>{
        const el=document.getElementById(id); if(!el) return;
        el.addEventListener('click',fn);
        if(id.startsWith('dpad')){
          el.addEventListener('touchstart',(e)=>{e.preventDefault();this._start(fn);},{passive:false});
          el.addEventListener('touchend',  (e)=>{e.preventDefault();this._stop();}, {passive:false});
          el.addEventListener('touchcancel',(e)=>{e.preventDefault();this._stop();},{passive:false});
          el.addEventListener('mousedown',()=>this._start(fn));
          el.addEventListener('mouseup',  ()=>this._stop());
          el.addEventListener('mouseleave',()=>this._stop());
        }
      };
      b('dpad-up',   ()=>{ Camera.panY+=this.STEP; });
      b('dpad-down', ()=>{ Camera.panY-=this.STEP; });
      b('dpad-left', ()=>{ Camera.panX+=this.STEP; });
      b('dpad-right',()=>{ Camera.panX-=this.STEP; });
      document.getElementById('btn-zoom-in') ?.addEventListener('click',()=>Input.applyZoom(1.2,REALM.canvas.width/2,REALM.canvas.height/2));
      document.getElementById('btn-zoom-out')?.addEventListener('click',()=>Input.applyZoom(0.82,REALM.canvas.width/2,REALM.canvas.height/2));
      document.getElementById('btn-reset-cam')?.addEventListener('click',()=>this.reset());
    },
    reset(){
      Camera.zoom=1.0; Camera.panX=0; Camera.panY=0;
      for(let gy=0;gy<GRID_H;gy++) for(let gx=0;gx<GRID_W;gx++){
        const t=World.get(gx,gy);
        if(t&&t.f===1&&t.b===B.CAPITAL){ Camera.centreOn(gx,gy); HUD.notify('⌖ Camera reset'); return; }
      }
    },
    _start(fn){ this._stop(); fn(); this._held=setInterval(fn,80); },
    _stop(){ if(this._held){ clearInterval(this._held); this._held=null; } },
  };

  /* ═══════════════════════════════════════════
     SAVE / LOAD
  ═══════════════════════════════════════════ */
  const Save={
    KEY:'realm_save',
    save(){
      const j=World.serialise();
      try{ localStorage.setItem(this.KEY,j); window.REALM_LAST_SAVE=j; HUD.notify('💾 Game saved'); return j; }
      catch(e){ HUD.notify('Save failed'); return null; }
    },
    load(json){
      if(!json) json=localStorage.getItem(this.KEY);
      if(!json) return false;
      return World.deserialise(json);
    },
  };

  /* ═══════════════════════════════════════════
     HOME SCREEN ANIMATED BACKGROUND
  ═══════════════════════════════════════════ */
  const HomeScreen={
    canvas:null, ctx:null, t:0, raf:null,
    particles:[],

    init(){
      this.canvas=document.getElementById('home-bg');
      this.ctx=this.canvas.getContext('2d');
      this.resize();
      window.addEventListener('resize',()=>this.resize());
      // Generate floating particles
      for(let i=0;i<60;i++){
        this.particles.push({
          x:Math.random(),y:Math.random(),
          vx:(Math.random()-.5)*.0002,
          vy:(Math.random()-.5)*.0001,
          r:Math.random()*2+0.5,
          alpha:Math.random()*.6+.1,
          color:Math.random()>.5?'#c8860a':'#4a90d9',
        });
      }
      this.loop();
    },

    resize(){
      if(!this.canvas) return;
      this.canvas.width=window.innerWidth;
      this.canvas.height=window.innerHeight;
    },

    loop(){
      this.raf=requestAnimationFrame(()=>this.loop());
      this.draw();
    },

    draw(){
      const ctx=this.ctx, W=this.canvas.width, H=this.canvas.height;
      this.t+=0.008;

      // Deep sky background
      const bg=ctx.createLinearGradient(0,0,0,H);
      bg.addColorStop(0,'#060810');
      bg.addColorStop(0.5,'#0a1020');
      bg.addColorStop(1,'#101828');
      ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

      // Animated slow-moving isometric tile grid hint in background
      ctx.save();
      ctx.globalAlpha=0.07;
      ctx.strokeStyle='#c8860a';
      ctx.lineWidth=1;
      const tw=80, th=40;
      const offX=(this.t*8)%(tw);
      for(let gx=-2;gx<W/tw*2+2;gx++){
        for(let gy=-2;gy<H/th+2;gy++){
          const sx=(gx-gy)*tw/2+offX+W/2;
          const sy=(gx+gy)*th/2+H*0.35;
          ctx.beginPath();
          ctx.moveTo(sx,sy); ctx.lineTo(sx+tw/2,sy+th/2);
          ctx.lineTo(sx,sy+th); ctx.lineTo(sx-tw/2,sy+th/2);
          ctx.closePath(); ctx.stroke();
        }
      }
      ctx.restore();

      // Star particles
      for(const p of this.particles){
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0)p.x=1; if(p.x>1)p.x=0;
        if(p.y<0)p.y=1; if(p.y>1)p.y=0;
        ctx.beginPath();
        ctx.arc(p.x*W,p.y*H,p.r,0,Math.PI*2);
        ctx.fillStyle=p.color;
        ctx.globalAlpha=p.alpha*(0.7+Math.sin(this.t*2+p.x*10)*.3);
        ctx.fill();
      }
      ctx.globalAlpha=1;

      // Central glow orb
      const glow=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W*.45);
      glow.addColorStop(0,`rgba(200,134,10,${0.06+Math.sin(this.t)*.02})`);
      glow.addColorStop(0.5,`rgba(74,144,217,${0.04+Math.cos(this.t*.7)*.02})`);
      glow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=glow; ctx.fillRect(0,0,W,H);
    },

    stop(){
      if(this.raf){ cancelAnimationFrame(this.raf); this.raf=null; }
    },
  };

  /* ═══════════════════════════════════════════
     MAIN GAME LOOP
  ═══════════════════════════════════════════ */
  let lastT=0, frameId=null;
  function loop(ts){
    frameId=requestAnimationFrame(loop);
    if(ts-lastT<1000/FPS) return;
    lastT=ts;
    Renderer.render();
  }

  /* ═══════════════════════════════════════════
     REALM PUBLIC API
  ═══════════════════════════════════════════ */
  const REALM={
    canvas:null,
    sel:{gx:null,gy:null},
    menuOpen:false,

    init(){
      this.canvas=document.getElementById('realm-canvas');
      this.resize();
      window.addEventListener('resize',()=>this.resize());

      const ctx=this.canvas.getContext('2d');
      Renderer.init(ctx);
      HUD.init();
      Input.init(this.canvas);
      CameraControls.init();
      HomeScreen.init();

      // Check for injected save from Shortcuts
      if(window.SHORTCUTS_SAVE) window.REALM_INJECTED_SAVE=window.SHORTCUTS_SAVE;
    },

    resize(){
      if(!this.canvas) return;
      this.canvas.width=window.innerWidth;
      this.canvas.height=window.innerHeight;
    },

    // Called by "New Game" button on home screen
    startNewGame(){
      HomeScreen.stop();
      document.getElementById('home-screen').classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      this._newWorld();
      frameId=requestAnimationFrame(loop);
    },

    // Called by "Continue" button
    startLoadGame(){
      const json=window.REALM_INJECTED_SAVE||null;
      if(Save.load(json)){
        HomeScreen.stop();
        document.getElementById('home-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        World.checkEra(); HUD.update();
        this._centreOnCapital();
        HUD.notify('📂 Save loaded — welcome back!',3000);
        frameId=requestAnimationFrame(loop);
      } else {
        HUD.notify('No save found — start a New Game');
        // Flash the new game button
        const btn=document.getElementById('btn-new-game');
        btn.style.outline='2px solid #f5c842';
        setTimeout(()=>btn.style.outline='',1500);
      }
    },

    _newWorld(){
      World.turn=1; World.level=1; World.era=0;
      World.resources=[
        {gold:50,food:30,prod:20},{gold:40,food:25,prod:15},
        {gold:40,food:25,prod:15},{gold:40,food:25,prod:15},{gold:40,food:25,prod:15},
      ];
      generateWorld();
      World.checkEra(); HUD.update();
      this._centreOnCapital();
      HUD.notify('👑 Your realm awaits — forge your empire!',3500);
    },

    _centreOnCapital(){
      for(let gy=0;gy<GRID_H;gy++) for(let gx=0;gx<GRID_W;gx++){
        const t=World.get(gx,gy);
        if(t&&t.f===1&&t.b===B.CAPITAL){ Camera.centreOn(gx,gy); return; }
      }
    },

    onTap(sx,sy){
      const {gx,gy}=Camera.fromScreen(sx,sy);
      const tile=World.get(gx,gy);
      if(!tile) return;
      this.sel={gx,gy};
      this._showTileInfo(gx,gy,tile);
    },

    _showTileInfo(gx,gy,tile){
      const TN=['Water','Plains','Forest','Hills','Mountain','Desert','Snow'];
      const BN=['—','Settlement','Farm','Mine','Barracks','Watch Tower','Capital','Port'];
      const owner=tile.f>0?FACTION_NAMES[tile.f-1]+(tile.f===1?' (YOU)':''):'Unclaimed';
      const yld=World.yield(tile);
      document.getElementById('tile-info-name').textContent=`${TN[tile.t]} (${gx},${gy})`;
      document.getElementById('tile-info-stats').innerHTML=
        `<b>Owner:</b> ${owner}<br>`+
        `<b>Building:</b> ${BN[tile.b]}<br>`+
        `<b>Elevation:</b> ${tile.z}<br>`+
        `<b>Yield:</b> ⚜${yld.gold} 🌾${yld.food} ⚒${yld.prod}`+
        (tile.u>0?`<br><b>Units:</b> ${tile.u} · ${FACTION_NAMES[(tile.uf||1)-1]}`:'');
      document.getElementById('tile-info').classList.remove('hidden');
    },

    endTurn(){
      this.closeBuildMenu();
      document.getElementById('tile-info').classList.add('hidden');
      World.collect(1);
      for(const t of World.grid) if(t.cd>0) t.cd--;
      for(let f=2;f<=5;f++){ World.collect(f); AI.process(f); }
      World.turn++; World.checkEra(); HUD.update();
      Combat.showLog();
      HUD.notify(`⏳ Turn ${World.turn} — your move`);
    },

    buildAt(gx,gy,bid){
      const tile=World.get(gx,gy);
      if(!tile||tile.f!==1){ HUD.notify('You do not own this tile'); return; }
      if(tile.b!==B.NONE){ HUD.notify('Tile already developed'); return; }
      const b=BUILDINGS.find(b=>b.id===bid); if(!b) return;
      const res=World.resources[0];
      if(res.gold<b.goldCost){ HUD.notify(`Need ${b.goldCost} Gold`); return; }
      if(res.prod<b.prodCost){ HUD.notify(`Need ${b.prodCost} Production`); return; }
      if(!b.validOn.includes(tile.t)){ HUD.notify('Cannot build here'); return; }
      res.gold-=b.goldCost; res.prod-=b.prodCost;
      World.set(gx,gy,{b:bid,cd:1});
      HUD.update(); HUD.notify(`🏗 ${b.name} constructed`);
    },

    openBuildMenu(){
      const tile=this.sel.gx!==null?World.get(this.sel.gx,this.sel.gy):null;
      HUD.updateBuildMenu(tile);
      document.getElementById('build-menu').classList.remove('hidden');
    },

    closeBuildMenu(){ document.getElementById('build-menu').classList.add('hidden'); },

    toggleMenu(){
      this.menuOpen=!this.menuOpen;
      document.getElementById('game-menu').classList.toggle('hidden',!this.menuOpen);
    },

    goHome(){
      if(frameId){ cancelAnimationFrame(frameId); frameId=null; }
      document.getElementById('hud').classList.add('hidden');
      document.getElementById('home-screen').classList.remove('hidden');
      this.toggleMenu();
      HomeScreen.init();
    },

    saveGame(){ return Save.save(); },
    loadSave(json){ if(Save.load(json)){ World.checkEra(); HUD.update(); this._centreOnCapital(); return true; } return false; },
    newGame(){ this._newWorld(); },

    World, Camera, Renderer, AI, Combat, Save, HUD,
  };

  window.REALM=REALM;

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>REALM.init());
  } else {
    REALM.init();
  }

})();
