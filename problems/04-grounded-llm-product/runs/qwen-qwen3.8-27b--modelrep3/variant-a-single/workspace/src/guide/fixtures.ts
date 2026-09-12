import type { WikiSource } from './guide.types.js';

/**
 * The fetched wiki pages, provided as fixtures. Scenarios answer only from
 * these texts; the grounding gate can see nothing else.
 */

export const EMBER_ALTAR_PAGE: WikiSource = {
  id: 'ember-altar',
  title: 'Ember Altar',
  text:
    'The Ember Altar stands at the heart of the Mirefen. ' +
    'It demands 4 ember shards before it can be kindled. ' +
    'Kindled, it burns cold and lights the way out of the swamp. ' +
    'The altar was sealed long before the last survey.',
};

export const MIREFEN_PAGE: WikiSource = {
  id: 'mirefen',
  title: 'Mirefen',
  text:
    'The Mirefen is a flooded valley south of Ashbridge. ' +
    "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
    'The water is ankle-deep by day and deep by night. ' +
    'Frost gates stand across the only path out.',
};

export const DUSKFANG_PAGE: WikiSource = {
  id: 'duskfang-warden',
  title: 'Duskfang Warden',
  text:
    'The Duskfang Warden is a boss that guards the Ember Altar. ' +
    'It drops a warden sigil after a clean defeat. ' +
    'The warden sigil opens the gate behind the altar. ' +
    'It patrols the reed beds after nightfall.',
};

export const ALL_WIKI_PAGES: WikiSource[] = [EMBER_ALTAR_PAGE, MIREFEN_PAGE, DUSKFANG_PAGE];
