import {formatPlannedItems} from './global';
import {PlanVaisseau, Technologie} from '../types';

const composant: Technologie = {
    base: 'moteur', code: 'moteurI', niv: 0, nom: 'Moteur', type: 1,
    recherche: 0, parents: [], caracteristiques: [],
    marchandises: [{code: 3, nb: 2}],
};

const batiment: Technologie = {
    base: 'mine', code: 'mineI', niv: 0, nom: 'Mine', type: 0,
    recherche: 0, parents: [], caracteristiques: [],
    specification: {pc: 5, min: 10, prix: 40} as any,
};

const planPublic: PlanVaisseau = {
    nom: 'Éclaireur', pc: 2, minerai: 20, prix: 30,
    composants: [{code: 'moteurI', nb: 1}],
};

describe('formatPlannedItems', () => {
    it('compte les centaures, PDC, minerai et marchandises des vaisseaux', () => {
        const r = formatPlannedItems(
            [{type: 'ship', code: 'Éclaireur', quantity: 3}],
            [composant],
            [planPublic],
        );
        expect(r.totalGlobalCost.prix).toBe(90);
        expect(r.totalGlobalCost.pdc).toBe(6);
        expect(r.totalGlobalCost.minerai).toBe(60);
        expect(r.totalGlobalCost.marchandises).toEqual([{code: 3, nb: 6}]);
    });

    it('additionne bâtiments et vaisseaux', () => {
        const r = formatPlannedItems(
            [
                {type: 'building', code: 'mineI', quantity: 2},
                {type: 'ship', code: 'Éclaireur', quantity: 1},
            ],
            [composant, batiment],
            [planPublic],
        );
        expect(r.totalGlobalCost.prix).toBe(110);
    });

    it('ne compte rien pour un plan absent de la liste fournie', () => {
        const r = formatPlannedItems(
            [{type: 'ship', code: 'Éclaireur', quantity: 1}],
            [composant],
            [],
        );
        expect(r.totalGlobalCost.prix).toBe(0);
    });
});
