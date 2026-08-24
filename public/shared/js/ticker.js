/* ============================================================
   BANDEAU DEFILANT — meme flux d'annonces sur les trois pages.
   ============================================================ */

(function(){
  var NEWS = [
    "SECTEUR 07 — TEMPÊTE DE DÉBRIS EN APPROCHE",
    "RAPPEL : LE SAS 3 N'EST PAS UNE POUBELLE",
    "LE CAFÉ DE BORD EST FROID DEPUIS 47 JOURS",
    "PERDU : UNE CLÉ À MOLETTE EN ORBITE BASSE — RÉCOMPENSE HONNÊTE",
    "LA GRAVITÉ ARTIFICIELLE SERA RÉTABLIE APRÈS LA PAUSE DÉJEUNER",
    "MERCI DE NE PAS NOURRIR LES DÉBRIS",
    "QUELQU'UN A REPEINT LE SAS EN ORANGE — NOUS CHERCHONS TOUJOURS QUI",
    "LE DISTRIBUTEUR DU PONT 4 MANGE ENCORE LES JETONS",
    "LA FOREUSE 12 FAIT UN BRUIT BIZARRE, ON PRÉFÈRE NE PAS SAVOIR",
    "AUCUNE BALISE DE SECOURS DÉTECTÉE — ON A BIEN CHERCHÉ, PROMIS"
  ];
  var el = document.getElementById("tick");
  if (!el) return;
  var html = "";
  for (var i = 0; i < NEWS.length; i++) html += "<b>" + NEWS[i] + "</b>";
  el.innerHTML = html + html;
})();
