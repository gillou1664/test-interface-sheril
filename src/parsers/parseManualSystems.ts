import {Rapport, SystemeDetecte, XY} from '../types';
import {getTorusDistance, parsePosString} from '../utils/position';

/** Portée radar d'un système ou d'une flotte d'un allié (case détectée : distance de Tchebychev ≤ scan) */
export type RadarAllie = {
  cdt: number;
  pos: XY;
  scan: number;
  tour?: number;
};

export type ManualParseResult = {
  systems: SystemeDetecte[];
  radars: RadarAllie[];
  errors: { line: number; message: string }[];
};

// Parse lines like:
// nbpla=16; nom=Nb 9C; pop=3475; popMax=43547; pos=0_1_26; typeEtoile=1; proprios=4,1
// pop, popMax et tour (tour de l'information) sont facultatifs ; une ligne commençant par « # » est
// un commentaire (en-tête du texte produit par exportSystemesJoueur).
// Une ligne avec « radar= » décrit une portée radar d'allié :
// radar=4; pos=0_10_20; cdt=7; tour=5
export function parseManualDetectedSystems(text: string): ManualParseResult {
  const systems: SystemeDetecte[] = [];
  const radars: RadarAllie[] = [];
  const errors: { line: number; message: string }[] = [];

  if (!text || !text.trim()) return { systems, radars, errors };

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const lineNum = idx + 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) return; // ligne vide ou commentaire
    try {
      const parts = line.split(';').map(s => s.trim()).filter(Boolean);
      const map: Record<string, string> = {};
      parts.forEach(p => {
        const [kRaw, ...rest] = p.split('=');
        const k = (kRaw || '').trim().toLowerCase();
        const v = rest.join('=').trim();
        if (k) map[k] = v;
      });

      const posStr = map['pos'];
      if (!posStr) throw new Error('pos manquant');
      const pos = parsePosString(posStr);

      if (map['radar'] !== undefined) {
        const cdt = safeInt(map['cdt'] ?? '0');
        if (!cdt) throw new Error('cdt manquant pour un radar');
        const tourRadar = safeInt(map['tour'] ?? '0');
        radars.push({cdt, pos, scan: safeInt(map['radar']), ...(tourRadar > 0 ? {tour: tourRadar} : {})});
        return;
      }

      const nom = map['nom'] || 'Système';
      const nbPla = safeInt(map['nbpla'] ?? map['nbpl'] ?? '0');
      const typeEtoile = safeInt(map['typeetoile'] ?? map['etoile'] ?? map['type'] ?? '0');

      const ownersStr = map['proprios'] ?? map['proprietaires'] ?? map['proprio'] ?? '';
      const proprietaires = ownersStr
        ? ownersStr.split(',').map(s => safeInt(s.trim())).filter(n => !Number.isNaN(n))
        : [];

      const optionnel = (k: string) => (map[k] !== undefined && map[k] !== '' ? safeInt(map[k]) : undefined);
      const systeme: SystemeDetecte = {
        type: 'detecte',
        nom,
        pos,
        typeEtoile,
        nbPla,
        proprietaires: proprietaires.sort((a, b) => a - b),
      };
      const pop = optionnel('pop');
      const popMax = optionnel('popmax');
      const tour = optionnel('tour');
      if (pop !== undefined) systeme.pop = pop;
      if (popMax !== undefined) systeme.popMax = popMax;
      if (tour !== undefined && tour > 0) systeme.tour = tour;
      systems.push(systeme);
    } catch (e: any) {
      errors.push({ line: lineNum, message: e?.message || 'Ligne invalide' });
    }
  });

  return { systems, radars, errors };
}

/**
 * Texte des systèmes du joueur, une ligne par système, à transmettre à un allié (Discord, mail…) :
 * il le colle dans « Importer systèmes » (parseManualDetectedSystems). Les systèmes du joueur ne
 * sont pas partagés automatiquement par l'alliance, contrairement aux détections.
 * Suivent les portées radar des systèmes et des flottes du joueur (position au tour du rapport).
 * Les détections propres (facultatives) sont les systèmes détectés à ce tour qui sont à portée d'un radar
 * de système ou d'un scanner de flotte du joueur (distance de Tchebychev ≤ portée, comme
 * `Commandant.determinerSystemesDetectes`) : celles mises en commun par l'alliance sont écartées, pour
 * pouvoir les transmettre à un commandant hors de l'alliance. Les détections de l'alliance (facultatives)
 * sont les autres systèmes détectés à ce tour : hors de portée des radars du joueur, ils viennent des alliés.
 * `contenu` choisit ce qui est exporté (systèmes et radars par défaut, sans aucune détection).
 */
export function exportSystemesJoueur(
  rapport: Pick<Rapport, 'tour' | 'joueur' | 'systemesJoueur'> & Partial<Pick<Rapport, 'flottesJoueur' | 'systemesDetectesDuTour'>>,
  contenu: { systemes?: boolean; radars?: boolean; detections?: boolean; detectionsAlliance?: boolean } = {},
): string {
  const avecSystemes = contenu.systemes ?? true;
  const avecRadars = contenu.radars ?? true;
  const avecDetections = contenu.detections ?? false;
  const avecDetectionsAlliance = contenu.detectionsAlliance ?? false;
  const propre = (s: string) => s.replace(/[;\r\n]+/g, ' ').trim();
  const lignes = !avecSystemes ? [] : rapport.systemesJoueur.map(s => {
    const autres = (s.proprietaires || []).filter(o => o !== 0);
    const proprios = Array.from(new Set(autres.length ? autres : [rapport.joueur.numero])).sort((a, b) => a - b);
    return [
      `nbpla=${s.nbPla}`,
      `nom=${propre(s.nom)}`,
      ...(s.pop != null ? [`pop=${s.pop}`] : []),
      ...(s.popMax != null ? [`popMax=${s.popMax}`] : []),
      `pos=0_${s.pos.x}_${s.pos.y}`,
      `typeEtoile=${s.typeEtoile}`,
      `proprios=${proprios.join(',')}`,
      `tour=${rapport.tour}`,
    ].join('; ');
  });
  const observateurs = [...rapport.systemesJoueur, ...(rapport.flottesJoueur || [])]
    .filter(o => Number(o.scan) > 0);
  const radars = !avecRadars ? [] : observateurs
    .map(o => `radar=${Number(o.scan)}; pos=0_${o.pos.x}_${o.pos.y}; cdt=${rapport.joueur.numero}; tour=${rapport.tour}`);
  const ligneDetection = (s: SystemeDetecte) => [
    `nbpla=${s.nbPla}`,
    `nom=${propre(s.nom)}`,
    ...(s.pop != null ? [`pop=${s.pop}`] : []),
    ...(s.popMax != null ? [`popMax=${s.popMax}`] : []),
    `pos=0_${s.pos.x}_${s.pos.y}`,
    `typeEtoile=${s.typeEtoile}`,
    `proprios=${(s.proprietaires || []).join(',')}`,
    `tour=${s.tour ?? rapport.tour}`,
  ].join('; ');
  const {propres, alliance} = repartirDetections(rapport, observateurs);
  const detections = !avecDetections ? [] : propres.map(ligneDetection);
  const detectionsAlliance = !avecDetectionsAlliance ? [] : alliance.map(ligneDetection);
  const parties = [
    ...(avecSystemes ? [`${lignes.length} système(s)`] : []),
    ...(avecDetections ? [`${detections.length} détection(s)`] : []),
    ...(avecDetectionsAlliance ? [`${detectionsAlliance.length} détection(s) de l'alliance`] : []),
    ...(avecRadars ? [`${radars.length} radar(s)`] : []),
  ];
  if (!parties.length) return '';
  const entete = `# Systèmes de ${propre(rapport.joueur.nom || '')} (n°${rapport.joueur.numero}), tour ${rapport.tour} : ` +
    `${parties.join(' et ')}, à coller dans « Importer systèmes » de l'outil d'aide`;
  return [entete, ...lignes, ...detections, ...detectionsAlliance, ...radars].join('\n');
}

/**
 * Répartit les systèmes détectés à ce tour (sans ceux où le joueur a une planète) entre ceux à portée
 * des radars du joueur lui-même (systèmes et flottes) et ceux que l'alliance a mis en commun. Triés par position.
 */
export function repartirDetections(
  rapport: Pick<Rapport, 'systemesJoueur'> & Partial<Pick<Rapport, 'flottesJoueur' | 'systemesDetectesDuTour'>>,
  observateurs: { pos: XY; scan: number }[] = [...rapport.systemesJoueur, ...(rapport.flottesJoueur || [])],
): { propres: SystemeDetecte[]; alliance: SystemeDetecte[] } {
  const radars = observateurs.filter(o => Number(o.scan) > 0);
  const possedes = new Set(rapport.systemesJoueur.map(s => `${s.pos.x}_${s.pos.y}`));
  const vus = new Set<string>();
  const propres: SystemeDetecte[] = [];
  const alliance: SystemeDetecte[] = [];
  [...(rapport.systemesDetectesDuTour || [])]
    .sort((a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y)
    .forEach(s => {
      const cle = `${s.pos.x}_${s.pos.y}`;
      if (possedes.has(cle) || vus.has(cle)) return;
      vus.add(cle);
      (radars.some(o => getTorusDistance(o.pos, s.pos) <= Number(o.scan)) ? propres : alliance).push(s);
    });
  return {propres, alliance};
}

function safeInt(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
