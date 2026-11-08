/* THE SYSTEM — sound engine
 * ---------------------------------------------------------------------------
 * Every sound is synthesized live with the Web Audio API: no audio files to
 * download, nothing extra to cache, works fully offline.
 *
 * Sound is used for moments that carry meaning (a quest cleared, a level or
 * rank gained, a boss fight, a finished timer, a logged workout, a purchase...)
 * plus a very soft, lowest-priority click on buttons. Nothing plays on scroll
 * or hover. Lowest-priority sounds (click, tock) never talk over a bigger one.
 *
 * Shared by index.html and app.html. The on/off choice is stored under one key
 * so it carries from the landing page into the app. Default: on (browsers keep
 * audio silent until the person's first tap anyway).
 *
 * API:  SFX.play(name, delaySeconds?)   SFX.enabled()   SFX.setEnabled(bool)
 *       SFX.NAMES                        SFX.unlock()
 */
(function(){
  'use strict';

  var KEY = 'the-system-sound';
  var MASTER = 1.4;

  /* ---------- preference ---------- */
  function readPref(){
    try{ return localStorage.getItem(KEY) !== '0'; }catch(e){ return true; }
  }
  function writePref(on){
    try{ localStorage.setItem(KEY, on ? '1' : '0'); }catch(e){}
  }
  var on = readPref();

  /* ---------- low-level synth helpers (work on any AudioContext, incl. Offline) ---------- */
  function tone(ctx, dest, o){
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    var t = o.t || 0, d = o.d || 0.2, a = o.a == null ? 0.006 : o.a, vol = o.g == null ? 0.15 : o.g;
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if(o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    if(o.lp){
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp[0], t);
      f.frequency.exponentialRampToValueAtTime(o.lp[1], t + d);
      osc.connect(f); f.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(dest);
    osc.start(t);
    osc.stop(t + d + 0.05);
  }

  // Slow-attack swell (for rank-up / awakening), amplitude rises then falls.
  function swell(ctx, dest, o){
    var osc = ctx.createOscillator();
    var f = ctx.createBiquadFilter();
    var g = ctx.createGain();
    var t = o.t || 0;
    osc.type = o.type || 'sawtooth';
    osc.frequency.setValueAtTime(o.f, t);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.lp[0], t);
    f.frequency.exponentialRampToValueAtTime(o.lp[1], t + o.rise);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g, t + o.rise);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
    osc.connect(f); f.connect(g); g.connect(dest);
    osc.start(t);
    osc.stop(t + o.d + 0.05);
  }

  var noiseBuf = null;
  function noise(ctx, dest, o){
    if(!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate){
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for(var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.ftype || 'bandpass';
    var t = o.t || 0;
    f.frequency.setValueAtTime(o.f[0], t);
    f.frequency.exponentialRampToValueAtTime(o.f[1], t + o.d);
    f.Q.value = o.q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g, t + (o.a || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t);
    src.stop(t + o.d + 0.05);
  }

  // A bell: fundamental + inharmonic partials, long exponential decay.
  function bell(ctx, dest, f, t, d, vol){
    tone(ctx, dest, { f: f,        t: t, d: d,       g: vol,       a: 0.004 });
    tone(ctx, dest, { f: f * 2.76, t: t, d: d * 0.5, g: vol * 0.35, a: 0.004 });
    tone(ctx, dest, { f: f * 5.4,  t: t, d: d * 0.25, g: vol * 0.15, a: 0.004 });
  }

  /* ---------- the sounds ----------
   * pri: higher beats lower when they collide (a rank-up silences a level-up chime).
   * dur: seconds the sound occupies, used for that collision rule.
   */
  var C4=261.63, E4=329.63, G4=392, C5=523.25, E5=659.25, G5=783.99, C6=1046.5, E6=1318.5;

  var SOUNDS = {
    // Soft UI click on any button. Lowest priority: if a real event sound (quest, log, tick...)
    // is already playing from the same tap, this one stays out of the way.
    click: { pri:0, dur:.07, play:function(c,d,t){
      tone(c,d,{f:1500, to:900, t:t, d:.035, g:.045, type:'triangle', a:.002});
      noise(c,d,{t:t, d:.025, g:.012, f:[3000,1500], q:.8, a:.001});
    }},
    // Optional focus-timer tick (off unless the person turns it on in Profile): a quiet wood-block tock.
    tock: { pri:0, dur:.08, play:function(c,d,t){
      tone(c,d,{f:1900, to:1300, t:t, d:.03, g:.04, a:.001});
      tone(c,d,{f:620,  t:t, d:.05, g:.03, type:'triangle', a:.001});
    }},
    // Last-5-seconds countdown beep for the focus timer.
    count: { pri:1, dur:.2, play:function(c,d,t){
      tone(c,d,{f:1175, t:t, d:.13, g:.09, type:'triangle', a:.003});
      tone(c,d,{f:2350, t:t, d:.07, g:.025, a:.003});
    }},
    // Workout / exercise / weight logged: a weighty thud, then a bright confirming two-note.
    log: { pri:2, dur:.7, play:function(c,d,t){
      tone(c,d,{f:140, to:60, t:t, d:.18, g:.22, a:.003});
      noise(c,d,{t:t, d:.08, g:.05, f:[900,200], q:.7, ftype:'lowpass', a:.002});
      tone(c,d,{f:659.25, t:t+.1,  d:.2,  g:.10, type:'triangle'});
      tone(c,d,{f:987.77, t:t+.19, d:.38, g:.10, type:'triangle'});
      tone(c,d,{f:1975.5, t:t+.19, d:.2,  g:.025});
    }},
    // Loading screen of the installed app: a short power-up that lands as the title glitches in.
    boot: { pri:2, dur:2.2, play:function(c,d,t){
      swell(c,d,{f:55,  t:t, rise:1.1, d:2.0, g:.10, lp:[150,1800]});
      swell(c,d,{f:110, t:t, rise:1.1, d:2.0, g:.05, lp:[150,2400]});
      noise(c,d,{t:t, d:1.1, g:.025, f:[300,4200], q:1.2, a:.6});
      tone(c,d,{f:64, to:40, t:t+1.0, d:.5, g:.2});
      [G4,C5,G5].forEach(function(f,i){ tone(c,d,{f:f, t:t+1.0+i*.07, d:.9, g:.06, type:'triangle'}); });
    }},
    // Small confirmation when a To-Do is checked off.
    tick:  { pri:1, dur:.25, play:function(c,d,t){
      tone(c,d,{f:988, t:t,     d:.08, g:.11, type:'triangle'});
      tone(c,d,{f:1319,t:t+.05, d:.14, g:.09, type:'triangle'});
    }},
    // A boss finishing-blow task got credited.
    ping:  { pri:1, dur:.3, play:function(c,d,t){
      tone(c,d,{f:1175,t:t, d:.22, g:.13});
      tone(c,d,{f:2350,t:t, d:.12, g:.035});
    }},
    // Store purchase.
    coin:  { pri:1, dur:.5, play:function(c,d,t){
      tone(c,d,{f:988, t:t,     d:.09, g:.06, type:'square'});
      tone(c,d,{f:1319,t:t+.07, d:.40, g:.06, type:'square'});
      tone(c,d,{f:2637,t:t+.07, d:.25, g:.03});
    }},
    // Daily quest cleared.
    quest: { pri:2, dur:.8, play:function(c,d,t){
      [C5,E5,G5,C6].forEach(function(f,i){ tone(c,d,{f:f, t:t+i*.07, d:.28, g:.13, type:'triangle'}); });
      tone(c,d,{f:C6, t:t+.28, d:.55, g:.10});
      tone(c,d,{f:E6, t:t+.28, d:.55, g:.06});
    }},
    // Achievement unlocked.
    achievement: { pri:2, dur:.9, play:function(c,d,t){
      [1568,2093,2637,3136].forEach(function(f,i){ tone(c,d,{f:f, t:t+i*.075, d:.4, g:.08}); });
      tone(c,d,{f:1047, t:t, d:.6, g:.06, type:'triangle'});
    }},
    // Focus session finished / break finished — soft bells, audible from another tab.
    timer: { pri:2, dur:1.8, play:function(c,d,t){
      bell(c,d,784,  t,     1.0, .14);
      bell(c,d,988,  t+.38, 1.0, .14);
      bell(c,d,1175, t+.76, 1.3, .15);
    }},
    // Level gained.
    levelup: { pri:3, dur:1.5, play:function(c,d,t){
      [G4,C5,E5,G5,C6].forEach(function(f,i){
        tone(c,d,{f:f, t:t+i*.09, d:.22, g:.07, type:'square'});
        tone(c,d,{f:f, t:t+i*.09, d:.30, g:.10, type:'triangle'});
      });
      [C5,E5,G5,C6].forEach(function(f){ tone(c,d,{f:f, t:t+.5, d:.95, g:.075, type:'triangle'}); });
    }},
    // Boss fight begins: dread.
    bossStart: { pri:3, dur:1.4, play:function(c,d,t){
      tone(c,d,{f:90, to:38, t:t, d:.7, g:.4, a:.01});
      noise(c,d,{t:t, d:.4, g:.14, f:[700,120], q:.7, ftype:'lowpass'});
      tone(c,d,{f:55,  t:t+.05, d:1.2, g:.12, type:'sawtooth', lp:[500,120]});
      tone(c,d,{f:110, t:t+.35, d:.9,  g:.06, type:'sawtooth', lp:[600,150]});
      tone(c,d,{f:116.5,t:t+.35,d:.9,  g:.05, type:'sawtooth', lp:[600,150]});
    }},
    // Penalty / rank loss.
    rankdown: { pri:3, dur:1.4, play:function(c,d,t){
      tone(c,d,{f:330, to:110, t:t, d:.95, g:.13, type:'sawtooth', lp:[1400,180]});
      tone(c,d,{f:220, to:73,  t:t, d:1.1, g:.14});
      tone(c,d,{f:55,  t:t+.1, d:1.0, g:.10, type:'sine'});
    }},
    // Rank gained: the big one.
    rankup: { pri:4, dur:2.8, play:function(c,d,t){
      swell(c,d,{f:65.4,  t:t, rise:1.0, d:2.4, g:.16, lp:[250,2600]});
      swell(c,d,{f:98,    t:t, rise:1.0, d:2.4, g:.10, lp:[250,2600]});
      swell(c,d,{f:130.8, t:t, rise:1.0, d:2.4, g:.07, lp:[300,3000]});
      noise(c,d,{t:t, d:1.0, g:.05, f:[300,4500], q:1.2, a:.5});
      tone(c,d,{f:55, to:36, t:t+.95, d:.7, g:.3});
      [C5,E5,G5,C6,E6].forEach(function(f,i){ tone(c,d,{f:f, t:t+.95+i*.06, d:1.3, g:.085, type:'triangle'}); });
      tone(c,d,{f:C6, t:t+1.0, d:1.6, g:.05, type:'sine'});
    }},
    // Boss defeated: fanfare.
    victory: { pri:4, dur:2.4, play:function(c,d,t){
      [[G4,0,.13],[G4,.13,.13],[G4,.26,.13],[C5,.4,.5],[E5,.92,.14],[G5,1.06,.9]].forEach(function(n){
        tone(c,d,{f:n[0], t:t+n[1], d:n[2]+.12, g:.08, type:'square'});
        tone(c,d,{f:n[0], t:t+n[1], d:n[2]+.2,  g:.11, type:'triangle'});
      });
      [C4,E4,G4].forEach(function(f){ tone(c,d,{f:f, t:t+1.06, d:1.2, g:.06, type:'sawtooth', lp:[1800,400]}); });
      tone(c,d,{f:70, to:45, t:t+1.06, d:.5, g:.22});
      [2093,2637,3136,4186].forEach(function(f,i){ tone(c,d,{f:f, t:t+1.25+i*.08, d:.5, g:.035}); });
    }},
    // The Awakening cutscene after onboarding.
    awaken: { pri:4, dur:3.6, play:function(c,d,t){
      tone(c,d,{f:55, t:t, d:3.2, g:.22, a:1.6});
      swell(c,d,{f:110, t:t, rise:1.9, d:3.0, g:.10, lp:[180,1800]});
      swell(c,d,{f:165, t:t, rise:1.9, d:3.0, g:.06, lp:[180,2200]});
      noise(c,d,{t:t, d:1.9, g:.04, f:[200,5000], q:1.5, a:1.2});
      tone(c,d,{f:48, to:32, t:t+1.9, d:.8, g:.28});
      [C4,G4,C5,E5,G5].forEach(function(f,i){ tone(c,d,{f:f, t:t+1.9+i*.05, d:1.5, g:.075, type:'triangle'}); });
      [1319,1760,2093].forEach(function(f,i){ tone(c,d,{f:f, t:t+2.1+i*.12, d:1.2, g:.03}); });
    }},
    // Landing page: entering the System.
    enter: { pri:1, dur:.3, play:function(c,d,t){
      tone(c,d,{f:740, t:t,     d:.07, g:.05, type:'square'});
      tone(c,d,{f:1480,t:t+.06, d:.16, g:.10});
      tone(c,d,{f:2960,t:t+.06, d:.10, g:.025});
    }}
  };

  /* ---------- runtime ---------- */
  var ctx = null, master = null, busyUntil = 0, busyPri = 0;

  function ensureContext(){
    if(ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    try{
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor();   // safety net against clipping on overlaps
      comp.threshold.value = -14; comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = MASTER;
      master.connect(comp); comp.connect(ctx.destination);
    }catch(e){ ctx = null; }
    return ctx;
  }

  function unlock(){
    if(!on) return;
    var c = ensureContext();
    if(c && c.state === 'suspended'){ try{ c.resume(); }catch(e){} }
  }
  // Browsers only allow audio after a real tap/key — unlock on the first one.
  ['pointerdown','touchend','keydown'].forEach(function(ev){
    window.addEventListener(ev, unlock, { passive:true });
  });

  function fire(name){
    if(!on) return;
    var s = SOUNDS[name];
    if(!s) return;
    var c = ensureContext();
    if(!c) return;
    if(c.state === 'suspended'){ try{ c.resume(); }catch(e){} }
    if(c.state !== 'running') return;            // no user gesture yet: stay silent, never error
    var now = c.currentTime;
    if(now < busyUntil && s.pri < busyPri) return;    // something more important is still playing
    busyUntil = now + s.dur; busyPri = s.pri;
    try{ s.play(c, master, now + 0.02); }catch(e){}
  }

  function play(name, delay){
    try{
      if(delay > 0) setTimeout(function(){ fire(name); }, delay * 1000);
      else fire(name);
    }catch(e){}
  }

  // Render a sound offline (used by tests; never by the app itself).
  function render(name, sampleRate){
    var s = SOUNDS[name];
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    sampleRate = sampleRate || 44100;
    var oc = new OAC(1, Math.ceil((s.dur + 1) * sampleRate), sampleRate);
    var comp = oc.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    var m = oc.createGain(); m.gain.value = MASTER;
    m.connect(comp); comp.connect(oc.destination);
    s.play(oc, m, 0.02);
    return oc.startRendering();
  }

  window.SFX = {
    play: play,
    unlock: unlock,
    enabled: function(){ return on; },
    setEnabled: function(v){
      on = !!v; writePref(on);
      if(on){ unlock(); }
      document.dispatchEvent(new CustomEvent('sfx-change', { detail:{ on:on } }));
    },
    NAMES: Object.keys(SOUNDS),
    _render: render
  };
})();
