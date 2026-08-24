/* ============================================================
   BANDES-SON — un morceau par page, qui tourne en boucle tant
   que la page est ouverte, et garde son propre niveau d'une
   visite a l'autre. Un navigateur refuse de jouer un son avant
   le premier geste de l'utilisateur : si la lecture est rejetee,
   on la reprend au premier clic ou a la premiere touche qui suit.
   ============================================================ */

function Track(id, key, def){
  var a = document.getElementById(id);
  var want = false, armed = false;

  /* Le morceau lui-meme plafonne a 80 : le curseur 0-100 se lit par-dessus,
     et se souvient d'une visite a l'autre. */
  var MASTER = .8, level = def, before = def;
  try {
    var saved = parseInt(localStorage.getItem(key), 10);
    if (saved >= 0 && saved <= 100) level = saved;
  } catch (e) {}
  if (level > 0) before = level;

  function apply(){ if (a) a.volume = MASTER * (level / 100); }
  apply();

  function setLevel(v){
    v = Math.round(v);
    level = v < 0 ? 0 : (v > 100 ? 100 : v);
    /* on retient le dernier niveau audible pour pouvoir y revenir */
    if (level > 0) before = level;
    apply();
    try { localStorage.setItem(key, String(level)); } catch (e2) {}
    return level;
  }

  /* le bouton bascule entre le silence et le dernier niveau tenu */
  function toggle(){ return setLevel(level > 0 ? 0 : (before || 30)); }

  function attempt(){
    if (!a || !want) return;
    var p;
    try { p = a.play(); } catch (e) { arm(); return; }
    if (p && p["catch"]) p["catch"](arm);
  }

  function arm(){
    if (armed || !want) return;
    armed = true;
    var go = function(){
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
      armed = false;
      attempt();
    };
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
  }

  function set(v){
    if (!a || v === want) return;
    want = v;
    if (v){ apply(); attempt(); }
    else { a.pause(); }
  }

  return { set: set, level: function(){ return level; },
           setLevel: setLevel, toggle: toggle };
}

/* Une piste peut avoir plusieurs commandes a l'ecran (le bandeau et le
   pied de page, par exemple). Elles montrent toutes le meme niveau et
   se remettent a jour ensemble. */
function VolumeUI(track){
  var ctl = [];

  function sync(){
    var lv = track.level(), i, c;
    for (i = 0; i < ctl.length; i++){
      c = ctl[i];
      /* on ne repousse pas la valeur dans le curseur que l'on tire */
      if (document.activeElement !== c.r) c.r.value = lv;
      c.o.value = lv;
      c.b.classList.toggle("off", lv === 0);
      c.b.setAttribute("aria-pressed", lv === 0 ? "true" : "false");
    }
  }

  function add(bId, rId, oId){
    var b = document.getElementById(bId),
        r = document.getElementById(rId),
        o = document.getElementById(oId);
    if (!b || !r || !o) return;
    ctl.push({ b:b, r:r, o:o });
    r.addEventListener("input", function(){
      track.setLevel(parseInt(r.value, 10) || 0);
      sync();
    });
    b.addEventListener("click", function(){ track.toggle(); sync(); });
    sync();
  }

  return { add: add, sync: sync };
}
