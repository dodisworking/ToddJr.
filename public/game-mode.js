// ═══════════════════════════════════════════════════════════
// GAME MODE — Mario-style scrolling platformer
// ←/→ move · SPACE jump · ENTER swing · reach the 🚩 to win!
// ═══════════════════════════════════════════════════════════
;(function () {

  const TPS = ARENA_TPS   // 4px per sprite pixel
  const TODD_W  = 11 * TPS  // sprite body width approx
  const TODD_SCREEN_X = 110 // Todd's target X on screen (camera target)
  const GM_CANVAS_H   = 220
  const GM_MOVE       = 2.4
  const GM_JUMP_VY    = 8.4
  const GM_GRAVITY    = 0.41
  const GM_FRAME_T    = 4
  const GM_BASE_COOL  = 14
  const GM_INVINCIBLE = 85
  const KILLS_PER_LVL = 10
  const FLAG_OFFSET   = 120    // flag is FLAG_OFFSET px before level end
  const PLAT_H        = 8

  // ── State ─────────────────────────────────────────────────
  Object.assign(arenaAnim, {
    gm:              false,
    gmHearts:        3,
    gmMaxHearts:     3,
    gmScore:         0,
    gmHiScore:       parseInt(localStorage.getItem('toddGmHiScore') || '0'),
    gmLevel:         1,
    gmKillsSinceLvl: 0,
    // World / scrolling
    gmWorldX:        TODD_SCREEN_X,   // Todd's world X (starts so camera=0)
    gmCameraX:       0,
    gmTerrain:       [],              // [{x, w, elev}] floating platforms in world space
    gmFlagX:         800,             // flagpole world X
    gmLevelLen:      1000,
    gmLevelWon:      false,
    gmWinTick:       0,
    // Physics
    gmElev:          0,
    gmVY:            0,
    gmOnGround:      true,
    gmMoveLeft:      false,
    gmMoveRight:     false,
    // Combat
    gmSwing:         false,
    gmSwingF:        0,
    gmSwingTick:     0,
    gmSwingQueued:   false,
    gmCooldown:      0,
    gmInvincible:    0,
    gmShake:         0,
    gmCombo:         0,
    gmComboTimer:    0,
    // Meta
    gmGrace:         60,
    gmGameOver:      false,
    gmGameOverTick:  0,
    gmNewHiScore:    false,
    gmHitFlash:      0,
    gmKillFlash:     0,
  })

  // ── Level generation ──────────────────────────────────────
  function buildLevel(lvNum) {
    const baseLen = 900 + lvNum * 300
    const flagX   = baseLen - FLAG_OFFSET
    const plats   = []
    const elevs   = [38, 52, 66, 80]
    let wx = 280   // first stretch is flat (run-up space)

    while (wx < flagX - 150) {
      // Guarantee at least one platform every 2 tries
      const elev = elevs[Math.floor(Math.random() * elevs.length)]
      const w    = 70 + Math.floor(Math.random() * 80)
      plats.push({ x: wx, w, elev })
      wx += w + 90 + Math.random() * 110
      // Sometimes add a second adjacent platform at a different height
      if (Math.random() > 0.55) {
        const elev2 = elevs[Math.floor(Math.random() * elevs.length)]
        const w2    = 55 + Math.floor(Math.random() * 60)
        plats.push({ x: wx - 30, w: w2, elev: elev2 })
      }
    }
    return { terrain: plats, flagX, levelLen: baseLen }
  }

  function lvlEnemySpeed(lv) { return 0.5 + (lv-1)*0.2 }
  function lvlSpawnMin(lv)   { return Math.max(5, 14-lv*1.5) }
  function lvlSpawnMax(lv)   { return Math.max(10, 24-lv*2) }

  // ── SFX ───────────────────────────────────────────────────
  function _gm(f,t,d,tp,v){ if(typeof _sfxMuted!=='undefined'&&_sfxMuted)return; if(typeof _sfxCtx==='undefined'||!_sfxCtx)return; const g=_sfxCtx.createGain();g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);const o=_sfxCtx.createOscillator();o.type=tp;o.frequency.setValueAtTime(f,t);o.connect(g);g.connect(_sfxCtx.destination);o.start(t);o.stop(t+d+.05) }
  function _w(){if(typeof _sfxCtx!=='undefined'&&_sfxCtx&&_sfxCtx.state==='suspended')_sfxCtx.resume()}
  function sfxSword() { _w();if(!_sfxCtx)return;const t=_sfxCtx.currentTime;_gm(1047,t,.03,'square',.14);_gm(784,t+.03,.03,'square',.11);_gm(440,t+.06,.05,'sawtooth',.09) }
  function sfxJump()  { _w();if(!_sfxCtx)return;const t=_sfxCtx.currentTime;_gm(330,t,.04,'square',.09);_gm(523,t+.04,.07,'square',.09) }
  function sfxLand()  { _w();if(!_sfxCtx)return;_gm(110,_sfxCtx.currentTime,.03,'square',.07) }
  function sfxHurt()  { _w();if(!_sfxCtx)return;const t=_sfxCtx.currentTime;_gm(110,t,.08,'sawtooth',.22);_gm(82,t+.09,.14,'sawtooth',.17) }
  function sfxKill(n) { _w();if(!_sfxCtx)return;const t=_sfxCtx.currentTime,b=n>1?659:523;_gm(b,t,.04,'square',.12);_gm(b*1.5,t+.04,.07,'square',.12);if(n>1)_gm(b*2,t+.1,.09,'square',.11) }
  function sfxStep()  { _w();if(!_sfxCtx)return;_gm(110,_sfxCtx.currentTime,.02,'square',.05) }
  function sfxLvlUp() { _w();if(!_sfxCtx)return;const t=_sfxCtx.currentTime;[523,659,784,1047].forEach((f,i)=>_gm(f,t+i*.09,.1,'square',.1)) }
  function sfxWin()   { _w();if(!_sfxCtx)return;const t=_sfxCtx.currentTime;[523,659,784,659,784,1047].forEach((f,i)=>_gm(f,t+i*.11,.12,'square',.12)) }
  function sfxOver()  { _w();if(!_sfxCtx)return;const t=_sfxCtx.currentTime;[440,392,349,294].forEach((f,i)=>_gm(f,t+i*.15,.14,'sawtooth',.14)) }
  function sfxRetry() { _w();if(!_sfxCtx)return;const t=_sfxCtx.currentTime;_gm(261,t,.06,'square',.1);_gm(392,t+.06,.06,'square',.1);_gm(523,t+.12,.12,'square',.12) }
  function sfxHiScore(){ _w();if(!_sfxCtx)return;const t=_sfxCtx.currentTime;[523,659,784,1047].forEach((f,i)=>_gm(f,t+i*.1,.12,'square',.12)) }

  // ── Pop text ──────────────────────────────────────────────
  const gmPops = []
  function addPop(sx,sy,txt,col){gmPops.push({x:sx,y:sy,txt,tick:0,color:col||'#fbbf24'})}

  // ── HTML HUD sync ─────────────────────────────────────────
  function syncHUD(){
    const a=arenaAnim
    for(let i=0;i<a.gmMaxHearts;i++){
      const el=document.getElementById('gm-heart-'+i)
      if(el){el.classList.toggle('filled',i<a.gmHearts);el.classList.toggle('empty',i>=a.gmHearts)}
    }
    const sc=document.getElementById('gm-score-val'),hi=document.getElementById('gm-hi-val'),lv=document.getElementById('gm-lv-val')
    if(sc) sc.textContent=a.gmScore; if(hi) hi.textContent=a.gmHiScore; if(lv) lv.textContent=a.gmLevel
  }

  // ── Platform pixel art ────────────────────────────────────
  function drawPlatform(ctx, screenX, elev, w, GY){
    const py=GY-elev
    ctx.globalAlpha=.25;ctx.fillStyle='#000';ctx.fillRect(screenX+3,py+PLAT_H+2,w,3);ctx.globalAlpha=1
    ctx.fillStyle='#1e293b';ctx.fillRect(screenX,py,w,PLAT_H)
    ctx.fillStyle='#334155';ctx.fillRect(screenX,py+2,w,PLAT_H-4)
    ctx.fillStyle='#64748b';ctx.fillRect(screenX,py,w,2)
    ctx.fillStyle='#1e293b'
    for(let bx=screenX+16;bx<screenX+w-2;bx+=16) ctx.fillRect(bx,py+2,1,PLAT_H-4)
    ctx.fillStyle='#4ade80';ctx.globalAlpha=.3
    for(let mx=screenX+5;mx<screenX+w-4;mx+=10) ctx.fillRect(mx,py,2,1)
    ctx.globalAlpha=1
  }

  // ── Flagpole draw ─────────────────────────────────────────
  function drawFlag(ctx, sx, GY, tick){
    if(sx<-30||sx>ctx.canvas.width+30) return
    // Pole
    ctx.fillStyle='#94a3b8'; ctx.fillRect(sx,GY-72,3,72)
    // Flag wave
    const wave=Math.sin(tick*.12)*4
    ctx.fillStyle='#ef4444'; ctx.fillRect(sx+3,GY-72,22+wave,14)
    ctx.fillStyle='#fbbf24'; ctx.fillRect(sx+3,GY-72,4,14)  // yellow stripe
    // Base
    ctx.fillStyle='#64748b'; ctx.fillRect(sx-5,GY-2,13,4)
    // Pole tip star
    ctx.fillStyle='#fbbf24'; ctx.fillRect(sx,GY-76,3,4)
  }

  // ── Patch updateArena ─────────────────────────────────────
  const _origUpdate = window.updateArena
  window.updateArena = function(){
    const a=arenaAnim
    if(!a.gm){_origUpdate();return}
    a.tick++
    if(a.victory){_origUpdate();return}

    // Win tick — wait then next level
    if(a.gmLevelWon){
      a.gmWinTick++
      if(a.gmWinTick===130){
        // Start next level
        a.gmLevel++; a.gmKillsSinceLvl=0
        const lvl=buildLevel(a.gmLevel)
        a.gmTerrain=lvl.terrain; a.gmFlagX=lvl.flagX; a.gmLevelLen=lvl.levelLen
        // Place Todd at start of new level
        a.gmWorldX=TODD_SCREEN_X; a.gmCameraX=0; a.gmElev=0; a.gmVY=0; a.gmOnGround=true
        a.gmLevelWon=false; a.gmWinTick=0; a.gmGrace=50; a.gmCombo=0; a.gmComboTimer=0
        a.animals=[]; a.spawnIn=20; gmPops.length=0
        syncHUD()
      }
      return
    }

    if(a.gmGameOver){
      a.gmGameOverTick++
      for(const en of a.animals){if(!en.dying)en.dying=true;en.deathTick++}
      a.animals=a.animals.filter(en=>en.deathTick<20); return
    }

    if(a.gmHitFlash  >0) a.gmHitFlash--
    if(a.gmKillFlash >0) a.gmKillFlash--
    if(a.gmInvincible>0) a.gmInvincible--
    if(a.gmShake     >0) a.gmShake=Math.max(0,a.gmShake-.5)
    if(a.gmComboTimer>0){a.gmComboTimer--;if(a.gmComboTimer===0)a.gmCombo=0}
    if(a.gmGrace     >0) a.gmGrace--
    for(const p of gmPops) p.tick++
    gmPops.splice(0,gmPops.length,...gmPops.filter(p=>p.tick<38))

    const cv=document.getElementById('arena-canvas')
    const W=cv?cv.width:800, H=cv?cv.height:GM_CANVAS_H, GY=H-18

    // ── Movement in world space ──────────────────────────
    const wasMoving=a.gmMoveLeft||a.gmMoveRight
    if(a.gmMoveLeft)  a.gmWorldX=Math.max(0,            a.gmWorldX-GM_MOVE)
    if(a.gmMoveRight) a.gmWorldX=Math.min(a.gmLevelLen, a.gmWorldX+GM_MOVE)
    if(wasMoving&&a.tick%14===0) sfxStep()

    // Camera follows Todd (snap, no lerp for crisp 8-bit feel)
    a.gmCameraX=Math.max(0, Math.min(a.gmLevelLen-W, a.gmWorldX-TODD_SCREEN_X))

    // ── Gravity + jump ───────────────────────────────────
    const wasOnGround=a.gmOnGround
    a.gmVY-=GM_GRAVITY
    let ne=a.gmElev+a.gmVY
    if(ne<=0){
      if(!wasOnGround&&a.gmVY<-3) sfxLand()
      ne=0;a.gmVY=0;a.gmOnGround=true
    } else {
      a.gmOnGround=false
      if(a.gmVY<=0){
        // Platform collision (world coords)
        for(const pl of a.gmTerrain){
          const tx1=a.gmWorldX+2*TPS, tx2=a.gmWorldX+10*TPS
          if(tx2>pl.x&&tx1<pl.x+pl.w&&a.gmElev>=pl.elev&&ne<=pl.elev){
            if(!wasOnGround) sfxLand()
            ne=pl.elev;a.gmVY=0;a.gmOnGround=true;break
          }
        }
        // Also check: Todd walked off a platform he was standing on — handled by ground=0 fallthrough
      }
    }
    a.gmElev=Math.max(0,ne)

    // ── Flag win detection ───────────────────────────────
    if(!a.gmLevelWon && a.gmWorldX+TODD_W >= a.gmFlagX){
      a.gmLevelWon=true; a.gmWinTick=0
      const bonus=50*a.gmLevel; a.gmScore+=bonus
      addPop(a.gmFlagX-a.gmCameraX, GY/2, 'LEVEL CLEAR! +'+bonus, '#4ade80')
      sfxWin(); syncHUD()
    }

    // ── Swing animation ──────────────────────────────────
    const toddScreenX=a.gmWorldX-a.gmCameraX
    if(a.gmSwing){
      if(++a.gmSwingTick>=GM_FRAME_T){
        a.gmSwingTick=0;a.gmSwingF++
        if(a.gmSwingF===2){
          // Strike — world coords, generous vertical window
          const strikeWorldX=a.gmWorldX+(ARENA_TODD_REACH-ARENA_TODD_X)+10
          const toddFeetY=GY-a.gmElev
          let killed=0
          for(const en of a.animals){
            if(en.dying||en.x>strikeWorldX||en.x<a.gmWorldX-20) continue
            const isBat=(en.def.fy||0)<-10
            const enBot=GY-(isBat?14:0), enTop=enBot-en.def.h*en.def.ps
            if(enBot>=toddFeetY-55&&enTop<=toddFeetY+12){en.dying=true;killed++}
          }
          if(killed){
            a.gmCombo++;a.gmComboTimer=90
            const pts=killed*Math.max(1,a.gmCombo-1)
            a.gmScore+=pts;a.gmKillFlash=10;a.gmKillsSinceLvl+=killed
            const popTxt=a.gmCombo>2?`${a.gmCombo}x COMBO +${pts}`:killed>1?`${killed}x +${pts}`:'+'+pts
            addPop(toddScreenX+50,toddFeetY-28,popTxt,a.gmCombo>2?'#f97316':killed>1?'#fbbf24':'#86efac')
            sfxKill(killed);syncHUD()
          }
        }
        if(a.gmSwingF>=4){
          a.gmSwing=false;a.gmSwingF=0
          if(a.gmSwingQueued){a.gmSwingQueued=false;a.gmSwing=true;a.gmSwingF=0;a.gmSwingTick=0;sfxSword()}
          else a.gmCooldown=GM_BASE_COOL
        }
      }
      a.toddF=a.gmSwingF
    } else {
      a.toddF=wasMoving?(Math.floor(a.tick/8)%2===0?0:3):0
      if(a.gmCooldown>0) a.gmCooldown--
    }

    // ── Spawn enemies (in world space ahead of Todd) ──────
    if(a.gmGrace<=0&&--a.spawnIn<=0&&a.animals.filter(x=>!x.dying).length<7){
      const def=ARENA_DEFS[Math.floor(Math.random()*ARENA_DEFS.length)]
      // Spawn at right edge of screen (world space)
      const spawnWorldX=a.gmCameraX+W+def.w*def.ps+10
      if(spawnWorldX < a.gmFlagX-20) {
        a.animals.push({def, x:spawnWorldX, bob:0,bobDir:1, dying:false, deathTick:0, moveTick:0})
      }
      const lv=a.gmLevel
      a.spawnIn=~~(lvlSpawnMin(lv)+Math.random()*(lvlSpawnMax(lv)-lvlSpawnMin(lv)))
    }

    // ── Enemy movement + hit detection ───────────────────
    const spd=lvlEnemySpeed(a.gmLevel), bodyWorldX=a.gmWorldX+(8*TPS)
    for(const en of a.animals){
      if(en.dying){en.deathTick++;continue}
      en.x-=(en.def.speed+spd)  // move left in world space
      en.moveTick++
      if(en.moveTick%10===0){en.bob+=en.bobDir;if(en.bob>=1||en.bob<=0)en.bobDir*=-1}

      // Body hit
      if(en.x<=bodyWorldX&&en.x>a.gmWorldX-40){
        const isBat=(en.def.fy||0)<-10
        const canHit=isBat?a.gmElev<38:a.gmElev<26
        if(!canHit||a.gmInvincible>0) continue
        en.dying=true; a.gmHearts--;a.gmHitFlash=22;a.gmShake=5;a.gmInvincible=GM_INVINCIBLE
        a.gmCombo=0;a.gmComboTimer=0
        addPop(toddScreenX+8,GY-a.gmElev-24,isBat?'BAT! -♥':'-1 ♥','#ef4444')
        sfxHurt();syncHUD()
        if(a.gmHearts<=0){
          a.gmHearts=0;a.gmGameOver=true
          if(a.gmScore>a.gmHiScore){a.gmHiScore=a.gmScore;a.gmNewHiScore=true;localStorage.setItem('toddGmHiScore',a.gmScore+'');setTimeout(sfxHiScore,600)}
          sfxOver();syncHUD()
        }
      }
    }
    // Despawn enemies behind Todd or past level end
    a.animals=a.animals.filter(en=>(!en.dying&&en.x>a.gmWorldX-100)||(en.dying&&en.deathTick<16))
  }

  // ── Patch drawArena ───────────────────────────────────────
  const _origDraw = window.drawArena
  window.drawArena = function(){
    const a=arenaAnim
    if(!a.gm){_origDraw();return}
    const cv=document.getElementById('arena-canvas');if(!cv)return
    const ctx=cv.getContext('2d')
    const W=cv.width,H=cv.height,GY=H-18
    const cam=a.gmCameraX
    const toddSX=a.gmWorldX-cam   // Todd's screen X

    ctx.save()
    if(a.gmShake>0) ctx.translate(a.tick%2===0?a.gmShake:-a.gmShake,0)

    // ── Sky ───────────────────────────────────────────────
    ctx.fillStyle='#07091A';ctx.fillRect(0,0,W,H)
    ctx.fillStyle='#0C1124'
    for(let x=0;x<W;x+=12) ctx.fillRect(x,0,1,GY)
    for(let y=0;y<GY;y+=12) ctx.fillRect(0,y,W,1)

    // Stars — parallax (scroll at 30% of camera speed)
    const STAR_POS=[50,7,140,13,270,4,400,10,530,6,660,15,780,3,900,11,1020,8,1140,5,320,11,700,5,180,9]
    for(let i=0;i<STAR_POS.length-1;i+=2){
      const worldSX=(STAR_POS[i]-cam*0.25+2000)%2000
      if(worldSX<0||worldSX>W) continue
      ctx.fillStyle=Math.sin(a.tick*.04+i)>0?'#FFFFFF':'#1E3A5F';ctx.fillRect(~~worldSX,STAR_POS[i+1],1,1)
    }

    // ── Ground ────────────────────────────────────────────
    ctx.fillStyle='#1E3A5F';ctx.fillRect(0,GY,W,2)
    ctx.fillStyle='#0F1B2D';ctx.fillRect(0,GY+2,W,H-GY-2)
    // Ground scrolling dashes
    ctx.fillStyle='#243B55'
    const gs=(cam*1.5)%24
    for(let x=-(24-gs%24);x<W;x+=24) ctx.fillRect(Math.round(x),GY,1,2)
    // Ground surface pixel detail
    ctx.fillStyle='#2a4a70'; ctx.globalAlpha=.4
    for(let x=(-(cam%32));x<W;x+=32) ctx.fillRect(x,GY,2,2)
    ctx.globalAlpha=1

    // ── Terrain platforms ────────────────────────────────
    for(const pl of a.gmTerrain){
      const sx=pl.x-cam
      if(sx>W+20||sx+pl.w<-20) continue   // cull offscreen
      drawPlatform(ctx,sx,pl.elev,pl.w,GY)
    }

    // ── Flagpole ─────────────────────────────────────────
    drawFlag(ctx, a.gmFlagX-cam, GY, a.tick)

    // ── Enemies ───────────────────────────────────────────
    for(const en of a.animals){
      const sx=Math.round(en.x-cam)
      if(sx>W+30||sx+en.def.w*en.def.ps<-10) continue
      const ay=GY-en.def.h*en.def.ps+(en.def.fy||0)+en.bob
      if(en.dying){
        ctx.globalAlpha=Math.max(0,1-en.deathTick/14)
        if(en.deathTick%4<2){ctx.fillStyle='#FCD34D';ctx.fillRect(sx-2,ay-2,en.def.w*en.def.ps+4,en.def.h*en.def.ps+4)}
        drawSpriteAt(ctx,en.def.d,sx,ay,en.def.ps);ctx.globalAlpha=1
      } else drawSpriteAt(ctx,en.def.s,sx,ay,en.def.ps)
    }

    // ── Todd ──────────────────────────────────────────────
    const sprite=ARENA_ATTACKS[a.toddF],tf=a.toddF
    const FB=[0,-4,0,3]
    const toddY=GY-sprite.length*TPS+FB[tf]-Math.round(a.gmElev)
    const blink=a.gmInvincible>0&&a.tick%8<4

    if(!blink){
      drawSpriteAt(ctx,sprite,toddSX,toddY,TPS)
      // Sword trails / slash effects
      if(tf===1){
        ctx.globalAlpha=.6;ctx.fillStyle='#FCD34D';ctx.fillRect(toddSX+10*TPS,toddY+1*TPS,TPS,TPS);ctx.fillRect(toddSX+11*TPS,toddY+2*TPS,TPS,TPS)
        ctx.fillStyle='#FFFFFF';ctx.fillRect(toddSX+11*TPS,toddY+1*TPS,TPS,TPS);ctx.globalAlpha=1
      } else if(tf===2){
        // LONG SLASH LINE across full screen
        ctx.globalAlpha=.92
        ctx.fillStyle='#FFFFFF';ctx.fillRect(toddSX+11*TPS,toddY+5*TPS,W-(toddSX+11*TPS),2)
        ctx.fillStyle='#FCD34D';ctx.fillRect(toddSX+11*TPS,toddY+5*TPS+2,W-(toddSX+12*TPS),2)
        ctx.fillRect(toddSX+11*TPS,toddY+4*TPS,4*TPS,2)
        // Burst glow at sword tip
        ctx.fillStyle='#FFFFFF';ctx.fillRect(toddSX+12*TPS,toddY+4*TPS,3*TPS,6)
        ctx.globalAlpha=.35;ctx.fillStyle='#FCD34D';ctx.fillRect(toddSX+10*TPS,toddY+3*TPS,6*TPS,10)
        ctx.globalAlpha=1
      } else if(tf===3){
        ctx.globalAlpha=.45;ctx.fillStyle='#FCD34D'
        ctx.fillRect(toddSX+11*TPS,toddY+7*TPS,TPS,TPS);ctx.fillRect(toddSX+12*TPS,toddY+8*TPS,TPS,TPS);ctx.fillRect(toddSX+13*TPS,toddY+9*TPS,TPS,TPS)
        ctx.globalAlpha=1
      }
    }
    // Invincible shimmer
    if(a.gmInvincible>0&&!blink){ctx.globalAlpha=.15;ctx.fillStyle='#60a5fa';ctx.fillRect(toddSX,toddY,sprite[0].length*TPS,sprite.length*TPS);ctx.globalAlpha=1}
    // Airborne shadow
    if(a.gmElev>2){ctx.globalAlpha=Math.min(.4,a.gmElev/110);ctx.fillStyle='#000';const sw=Math.max(4,20-a.gmElev*.18);ctx.fillRect(toddSX+4*TPS-sw/2,GY+1,sw,3);ctx.globalAlpha=1}
    // Nearby enemy sword impact glow
    const closeEnemy=a.animals.some(en=>!en.dying&&Math.abs(en.x-a.gmWorldX)<(ARENA_TODD_REACH-ARENA_TODD_X)+25)
    if(closeEnemy&&a.tick%6<3){const sx2=toddSX+(ARENA_TODD_REACH-ARENA_TODD_X)-2;ctx.fillStyle='#FCD34D';ctx.fillRect(sx2,toddY+5*TPS,10,3);ctx.fillStyle='#FFFFFF';ctx.fillRect(sx2+5,toddY+5*TPS,5,3)}

    // ── Flashes ───────────────────────────────────────────
    if(a.gmHitFlash>0){ctx.fillStyle=`rgba(220,38,38,${(a.gmHitFlash/22)*.3})`;ctx.fillRect(0,0,W,H)}
    if(a.gmKillFlash>0){ctx.fillStyle=`rgba(251,191,36,${(a.gmKillFlash/10)*.15})`;ctx.fillRect(0,0,W,H)}

    // ── HUD ───────────────────────────────────────────────
    ctx.font='7px "Press Start 2P",monospace';ctx.textBaseline='top'
    ctx.globalAlpha=.85;ctx.fillStyle='#7c3aed';ctx.textAlign='left';ctx.fillText('GAME MODE',4,4);ctx.globalAlpha=1
    ctx.fillStyle='#60a5fa';ctx.font='6px "Press Start 2P",monospace';ctx.fillText('LV.'+a.gmLevel,4,15)
    ctx.font='7px "Press Start 2P",monospace';ctx.textAlign='center'
    ctx.fillStyle='#fbbf24';ctx.fillText('\u2605 '+a.gmScore,W/2,4)
    if(a.gmCombo>=2){ctx.fillStyle='#f97316';ctx.font='6px "Press Start 2P",monospace';ctx.fillText(a.gmCombo+'x COMBO',W/2,15)}

    // Floating pop text
    ctx.textAlign='center'
    for(const pop of gmPops){ctx.globalAlpha=Math.max(0,1-pop.tick/38);ctx.fillStyle=pop.color;ctx.font='7px "Press Start 2P",monospace';ctx.fillText(pop.txt,pop.x,pop.y-pop.tick*.65)}
    ctx.globalAlpha=1

    // ENTER prompt + queued indicator
    if(!a.gmSwing&&!a.gmSwingQueued&&!a.gmGameOver&&!a.gmLevelWon&&a.gmCooldown===0){
      const danger=a.animals.some(en=>!en.dying&&en.x-cam<W*.55&&en.x>a.gmWorldX)
      if(danger&&a.tick%26<18){ctx.globalAlpha=.85;ctx.fillStyle='#4ade80';ctx.font='6px "Press Start 2P",monospace';ctx.textAlign='center';ctx.fillText('ENTER!',toddSX+10*TPS,toddY-12);ctx.globalAlpha=1}
    }
    if(a.gmSwingQueued){ctx.globalAlpha=.8;ctx.fillStyle='#f97316';ctx.font='6px "Press Start 2P",monospace';ctx.textAlign='center';ctx.fillText('\u2605 QUEUED',toddSX+8*TPS,toddY-14);ctx.globalAlpha=1}
    // Cooldown bar
    if(a.gmCooldown>0){const bX=toddSX+2*TPS,bY=toddY-10,bW=32,bH=3;ctx.fillStyle='#1e293b';ctx.fillRect(bX,bY,bW,bH);ctx.fillStyle='#7c3aed';ctx.fillRect(bX,bY,~~(bW*(1-a.gmCooldown/GM_BASE_COOL)),bH)}

    // Grace "GET READY"
    if(a.gmGrace>0){ctx.globalAlpha=Math.min(1,a.gmGrace/20);ctx.fillStyle='#94a3b8';ctx.font='6px "Press Start 2P",monospace';ctx.textAlign='center';ctx.fillText('GET READY...',W/2,GY/2);ctx.globalAlpha=1}

    // ── Progress bar ─────────────────────────────────────
    const prog=Math.min(1,(a.gmWorldX-TODD_SCREEN_X)/Math.max(1,a.gmFlagX-TODD_SCREEN_X-50))
    ctx.fillStyle='#1e293b';ctx.fillRect(0,H-4,W,4)
    ctx.fillStyle='#22c55e';ctx.fillRect(0,H-4,~~(W*prog),4)
    // Flag marker on progress bar
    ctx.fillStyle='#ef4444';ctx.fillRect(W-4,H-8,4,8)
    // Player dot
    ctx.fillStyle='#60a5fa';ctx.fillRect(~~(W*prog)-1,H-6,3,6)

    // ── LEVEL CLEAR overlay ───────────────────────────────
    if(a.gmLevelWon){
      const al=Math.min(1,a.gmWinTick/20)
      ctx.fillStyle=`rgba(0,0,0,${al*.6})`;ctx.fillRect(0,0,W,H)
      ctx.globalAlpha=al
      ctx.fillStyle='#4ade80';ctx.textAlign='center';ctx.font='10px "Press Start 2P",monospace';ctx.fillText('LEVEL CLEAR!',W/2,H/2-20)
      ctx.font='6px "Press Start 2P",monospace';ctx.fillStyle='#fbbf24';ctx.fillText('+'+50*a.gmLevel+' BONUS',W/2,H/2-4)
      ctx.fillStyle='#60a5fa';ctx.fillText('LV.'+(a.gmLevel+1)+' LOADING...',W/2,H/2+12)
      ctx.globalAlpha=1
    }

    // ── GAME OVER ─────────────────────────────────────────
    if(a.gmGameOver){
      const al=Math.min(1,a.gmGameOverTick/18)
      ctx.fillStyle=`rgba(0,0,0,${al*.75})`;ctx.fillRect(0,0,W,H)
      ctx.globalAlpha=(a.gmGameOverTick<8&&a.gmGameOverTick%2===0)?0:al
      ctx.fillStyle='#ef4444';ctx.textAlign='center';ctx.font='11px "Press Start 2P",monospace';ctx.fillText('GAME OVER',W/2,H/2-30)
      ctx.font='6px "Press Start 2P",monospace'
      ctx.fillStyle='#fbbf24';ctx.fillText('SCORE: '+a.gmScore,W/2,H/2-10)
      if(a.gmNewHiScore){if(a.gmGameOverTick%20<14){ctx.fillStyle='#f97316';ctx.fillText('\u2605 NEW BEST! \u2605',W/2,H/2+4)}}
      else{ctx.fillStyle='#64748b';ctx.fillText('BEST: '+a.gmHiScore,W/2,H/2+4)}
      ctx.fillStyle='#60a5fa';ctx.fillText('LV.'+a.gmLevel+' REACHED',W/2,H/2+18)
      if(a.gmGameOverTick>50&&a.gmGameOverTick%32<22){ctx.fillStyle='#a78bfa';ctx.fillText('PRESS ENTER TO RETRY',W/2,H/2+32)}
      ctx.globalAlpha=1
    }

    ctx.restore()
    ctx.textAlign='left';ctx.font='8px "Press Start 2P",monospace'
  }

  // ── Reset ─────────────────────────────────────────────────
  function resetGame(){
    const a=arenaAnim,cv=document.getElementById('arena-canvas')
    a.gmHearts=3;a.gmScore=0;a.gmLevel=1;a.gmKillsSinceLvl=0
    a.gmWorldX=TODD_SCREEN_X;a.gmCameraX=0
    a.gmElev=0;a.gmVY=0;a.gmOnGround=true
    a.gmMoveLeft=false;a.gmMoveRight=false
    a.gmSwing=false;a.gmSwingF=0;a.gmSwingTick=0;a.gmSwingQueued=false;a.gmCooldown=0
    a.gmInvincible=0;a.gmShake=0;a.gmCombo=0;a.gmComboTimer=0;a.gmGrace=60
    a.gmLevelWon=false;a.gmWinTick=0
    a.gmGameOver=false;a.gmGameOverTick=0;a.gmNewHiScore=false
    a.gmHitFlash=0;a.gmKillFlash=0
    a.animals=[];a.spawnIn=25;gmPops.length=0
    const lvl=buildLevel(1); a.gmTerrain=lvl.terrain; a.gmFlagX=lvl.flagX; a.gmLevelLen=lvl.levelLen
    syncHUD()
  }

  function toggleGameMode(){
    const a=arenaAnim,cv=document.getElementById('arena-canvas')
    const btn=document.getElementById('btn-game-mode'),ctrl=document.getElementById('nes-controller')
    if(!a.running){if(typeof toast!=='undefined')toast('Start a hunt first!','info');return}
    a.gm=!a.gm
    if(a.gm){
      if(cv){cv.height=GM_CANVAS_H;cv.style.height=GM_CANVAS_H+'px'}
      resetGame();ctrl?.classList.remove('hidden')
      document.getElementById('gm-status-bar')?.classList.add('visible')
      if(btn){btn.textContent='✕ EXIT';btn.classList.add('gm-active')}
    } else {
      if(cv){cv.height=120;cv.style.height=''}
      ctrl?.classList.add('hidden')
      document.getElementById('gm-status-bar')?.classList.remove('visible')
      if(btn){btn.textContent='🕹 GAME MODE';btn.classList.remove('gm-active')}
      a.gmMoveLeft=false;a.gmMoveRight=false;gmPops.length=0
    }
  }

  function gameModeSwing(){
    const a=arenaAnim; if(!a.gm||!a.running) return
    if(a.gmGameOver){resetGame();sfxRetry();return}
    if(a.victory||a.gmLevelWon) return
    if(a.gmSwing){a.gmSwingQueued=true;return}
    if(a.gmCooldown>0) return
    a.gmSwing=true;a.gmSwingF=0;a.gmSwingTick=0;a.gmSwingQueued=false; sfxSword()
    const btn=document.getElementById('nes-a-btn')
    if(btn){btn.classList.add('pressed');setTimeout(()=>btn.classList.remove('pressed'),110)}
  }

  function gameModeJump(){
    const a=arenaAnim; if(!a.gm||!a.running||a.gmGameOver||a.victory) return
    if(!a.gmOnGround) return
    a.gmVY=GM_JUMP_VY;a.gmOnGround=false;sfxJump()
    const btn=document.getElementById('nes-b-btn')
    if(btn){btn.classList.add('pressed');setTimeout(()=>btn.classList.remove('pressed'),110)}
    highlightDpad('up',true);setTimeout(()=>highlightDpad('up',false),150)
  }

  // Auto-exit on hunt victory
  setInterval(()=>{
    if(arenaAnim.gm&&arenaAnim.victory){
      const cv=document.getElementById('arena-canvas')
      if(cv){cv.height=120;cv.style.height=''}
      document.getElementById('nes-controller')?.classList.add('hidden')
      document.getElementById('gm-status-bar')?.classList.remove('visible')
      const btn=document.getElementById('btn-game-mode')
      if(btn){btn.textContent='🕹 GAME MODE';btn.classList.remove('gm-active')}
      arenaAnim.gm=false;arenaAnim.gmMoveLeft=false;arenaAnim.gmMoveRight=false;gmPops.length=0
    }
  },400)

  // ── Keyboard ──────────────────────────────────────────────
  document.addEventListener('keydown',e=>{
    if(!arenaAnim.gm) return
    switch(e.code){
      case 'Enter':      e.preventDefault();gameModeSwing();break
      case 'Space':      e.preventDefault();gameModeJump(); break
      case 'ArrowLeft':  e.preventDefault();arenaAnim.gmMoveLeft=true; highlightDpad('left',true); break
      case 'ArrowRight': e.preventDefault();arenaAnim.gmMoveRight=true;highlightDpad('right',true);break
      case 'ArrowUp': case 'KeyW': e.preventDefault();gameModeJump();break
      case 'KeyZ': case 'KeyX': gameModeSwing();break
    }
  })
  document.addEventListener('keyup',e=>{
    if(e.code==='ArrowLeft') {arenaAnim.gmMoveLeft=false;  highlightDpad('left',false)}
    if(e.code==='ArrowRight'){arenaAnim.gmMoveRight=false; highlightDpad('right',false)}
  })

  // D-pad hold
  function bindDpad(id,dir){
    const el=document.getElementById(id);if(!el)return
    const on=()=>{if(arenaAnim.gm){arenaAnim['gmMove'+dir]=true;highlightDpad(dir.toLowerCase(),true)}}
    const off=()=>{arenaAnim['gmMove'+dir]=false;highlightDpad(dir.toLowerCase(),false)}
    el.addEventListener('pointerdown',on);el.addEventListener('pointerup',off);el.addEventListener('pointerleave',off)
    el.addEventListener('touchstart',e=>{e.preventDefault();on()},{passive:false});el.addEventListener('touchend',off)
  }
  bindDpad('nes-dpad-left-btn','Left');bindDpad('nes-dpad-right-btn','Right')

  function highlightDpad(dir,on){
    const m={left:'nes-dpad-left-btn',right:'nes-dpad-right-btn',up:'nes-dpad-up-btn'}
    document.getElementById(m[dir])?.classList.toggle('dpad-pressed',on)
  }

  document.getElementById('nes-a-btn')?.addEventListener('click',gameModeSwing)
  document.getElementById('nes-b-btn')?.addEventListener('click',gameModeJump)
  document.getElementById('nes-dpad-up-btn')?.addEventListener('click',gameModeJump)
  document.getElementById('arena-canvas')?.addEventListener('click',()=>{if(arenaAnim.gm)gameModeSwing()})
  document.getElementById('btn-game-mode')?.addEventListener('click',toggleGameMode)

})()
