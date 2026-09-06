'use strict';

const EMPTY_ADDRESS_VALUES = new Set(['n/a', 'na', 'none', 'no address', 'unknown', 'null', '-', '--']);
const KNOWN_FLORIDA_CITIES = [
  'North Miami Beach',
  'North Bay Village',
  'Hialeah Gardens',
  'Miami Gardens',
  'Pembroke Pines',
  'Hallandale Beach',
  'West Palm Beach',
  'Fort Lauderdale',
  'Saint Petersburg',
  'Saint Peterburg',
  'St Petersburg',
  'Port Saint Lucie',
  'Deerfield Beach',
  'Coral Springs',
  'Boynton Beach',
  'Temple Terrace',
  'Wesley Chapel',
  'Cape Canaveral',
  'Allapattah',
  'Lehigh Acres',
  'Miami Beach',
  'Miami Lakes',
  'North Miami',
  'Coral Gables',
  'Pompano Beach',
  'Palmetto Bay',
  'Plant City',
  'Cutler Bay',
  'Cape Coral',
  'Lake Wales',
  'Lake Worth',
  'Moore Haven',
  'Spring Hill',
  'Port Richey',
  'Safety Harbor',
  'Miami Springs',
  'Miami Shores',
  'West Miami',
  'Opa Locka',
  'Opa-Locka',
  'Fort Pierce',
  'West Park',
  'Oakland Park',
  'Plantation',
  'Kissimmee',
  'Hollywood',
  'Homestead',
  'Lakeland',
  'Orlando',
  'Davenport',
  'Aventura',
  'Tamarac',
  'Margate',
  'Miramar',
  'Brandon',
  'Seffner',
  'Sunrise',
  'Sebring',
  'Valrico',
  'Holiday',
  'Ruskin',
  'Riverview',
  'Dunnellon',
  'Sarasota',
  'Dania',
  'Surfside',
  'Bartow',
  'Jacksonville',
  'Gibsonton',
  'Dover',
  'Northampton',
  'Princeton',
  'Palm Springs',
  'Palm Beach',
  'Lake Worth Beach',
  'Pinellas Park',
  'Palm Harbor',
  'Auburndale',
  'Apopka',
  'Immokalee',
  'Fort Myers',
  'Oviedo',
  'Lutz',
  'Medley',
  'Hialeah',
  'El Portal',
  'Naples',
  'Ocala',
  'Miami',
  'Tampa',
  'Weston',
  'Doral',
  'Davie',
  'Boca Raton'
].sort((left, right) => right.length - left.length);

const FLORIDA_CITY_ALIASES = new Map([
  ['OPALOCKA', 'Opa Locka'],
  ['OPA LOCKA', 'Opa Locka'],
  ['OPA-LOCKA', 'Opa Locka'],
  ['EL PORTAL', 'El Portal'],
  ['SAINT PETERSBURG', 'St Petersburg'],
  ['N SAINT PETERSBURG', 'St Petersburg'],
  ['SAINT PETERBURG', 'St Petersburg'],
  ['PETERSBURG', 'St Petersburg'],
  ['ST PETERBURG', 'St Petersburg'],
  ['MIAMI SPRINGS', 'Miami Springs'],
  ['MIAMI SHORES', 'Miami Shores'],
  ['LEHIGH ACRES', 'Lehigh Acres'],
  ['DEERFIELD BEACH', 'Deerfield Beach'],
  ['POMPANO BEACH', 'Pompano Beach'],
  ['PORT RICHEY', 'Port Richey'],
  ['CORAL GABLES', 'Coral Gables'],
  ['FORT LAUDERDALE', 'Fort Lauderdale'],
  ['FOURT LAUDERDALE', 'Fort Lauderdale'],
  ['FOURT LAUDELARDALE', 'Fort Lauderdale'],
  ['FOURT LOUDERDALE', 'Fort Lauderdale'],
  ['FOURDELLADE', 'Fort Lauderdale'],
  ['FORT LAURDALE', 'Fort Lauderdale'],
  ['FORT LAUDELARDALE', 'Fort Lauderdale'],
  ['HALLANDALE BEACH', 'Hallandale Beach'],
  ['PLANT CITY', 'Plant City'],
  ['PLAN CITY', 'Plant City'],
  ['CUTLER BAY', 'Cutler Bay'],
  ['CULTLER BAY', 'Cutler Bay'],
  ['CULTER BAY', 'Cutler Bay'],
  ['CUTER BAY', 'Cutler Bay'],
  ['LAKEWORTH', 'Lake Worth'],
  ['HIALEH', 'Hialeah'],
  ['HALEAH', 'Hialeah'],
  ['HAILEAH', 'Hialeah'],
  ['HILEAH', 'Hialeah'],
  ['HIALIAH', 'Hialeah'],
  ['JIALEAH', 'Hialeah'],
  ['MIAM', 'Miami'],
  ['MIA MI', 'Miami'],
  ['MIAMIA', 'Miami'],
  ['MIAMI BARCH', 'Miami Beach'],
  ['MIAMI LAKE', 'Miami Lakes'],
  ['MIAM LAKES', 'Miami Lakes'],
  ['MIAMI GAEDENS', 'Miami Gardens'],
  ['MIUAMI', 'Miami'],
  ['ALLAPTHA', 'Allapattah'],
  ['SPIRING HILL', 'Spring Hill'],
  ['WESTH PALM BEACH', 'West Palm Beach'],
  ['NORTHAMPTOM', 'Northampton'],
  ['PRICENTON', 'Princeton'],
  ['GOULD', 'Miami'],
  ['HPLLYWOOD', 'Hollywood'],
  ['HO ESTEAD', 'Homestead'],
  ['HOESTEAD', 'Homestead'],
  ['ESTEAD', 'Homestead'],
  ['HOMESTEAS', 'Homestead'],
  ['JACKSONVILE', 'Jacksonville'],
  ['WESLEY CHAPEL BLVD', 'Wesley Chapel'],
  ['TAMOA', 'Tampa'],
  ['TARRA', 'Tampa'],
  ['TAMP', 'Tampa'],
  ['WPB', 'West Palm Beach']
]);

const TAMPA_REGION_CITIES = Object.freeze([
  'Bartow',
  'Brandon',
  'Cape Coral',
  'Dover',
  'Holiday',
  'Kissimmee',
  'Lake Wales',
  'Lakeland',
  'Lehigh Acres',
  'Moore Haven',
  'Naples',
  'Orlando',
  'Plant City',
  'Port Richey',
  'Riverview',
  'Ruskin',
  'Sarasota',
  'Seffner',
  'Spring Hill',
  'St Petersburg',
  'Tampa',
  'Temple Terrace',
  'Valrico',
  'Wesley Chapel'
]);

const STREET_FRAGMENT_TOKENS = new Set([
  'AVE', 'AVENUE', 'BLVD', 'CIR', 'CT', 'DR', 'LN', 'LOOP', 'PATH', 'PKWY',
  'PL', 'RD', 'ST', 'TER', 'TERR', 'TRL', 'WAY'
]);

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC'
]);

const US_STATE_ALIASES = new Map([
  ['FLORIDA', 'FL'],
  ['PENNSYLVANIA', 'PA']
]);

const FLORIDA_ZIP_CITY = Object.freeze({
  '31609': 'Spring Hill',
  '32209': 'Jacksonville',
  '32805': 'Orlando',
  '32703': 'Apopka',
  '32712': 'Apopka',
  '32765': 'Oviedo',
  '32837': 'Orlando',
  '32867': 'Orlando',
  '33004': 'Dania',
  '33009': 'Hallandale Beach',
  '33010': 'Hialeah',
  '33012': 'Hialeah',
  '33013': 'Hialeah',
  '33014': 'Hialeah',
  '33015': 'Hialeah',
  '33016': 'Hialeah',
  '33018': 'Hialeah',
  '33020': 'Hollywood',
  '33021': 'Hollywood',
  '33023': 'Miramar',
  '33024': 'Hollywood',
  '33025': 'Pembroke Pines',
  '33026': 'Pembroke Pines',
  '33027': 'Miramar',
  '33028': 'Pembroke Pines',
  '33030': 'Homestead',
  '33031': 'Homestead',
  '33032': 'Homestead',
  '33032': 'Princeton',
  '33033': 'Homestead',
  '33034': 'Florida City',
  '33050': 'Miami Gardens',
  '33054': 'Opa Locka',
  '33055': 'Miami Gardens',
  '33056': 'Miami Gardens',
  '33058': 'Miami Gardens',
  '33063': 'Margate',
  '33064': 'Pompano Beach',
  '33065': 'Coral Springs',
  '33069': 'Pompano Beach',
  '33075': 'Miami Gardens',
  '33122': 'Doral',
  '33125': 'Miami',
  '33126': 'Miami',
  '33127': 'Miami',
  '33128': 'Miami',
  '33130': 'Miami',
  '33131': 'Miami',
  '33132': 'Miami',
  '33133': 'Miami',
  '33134': 'Coral Gables',
  '33135': 'Miami',
  '33136': 'Miami',
  '33137': 'Miami',
  '33138': 'Miami',
  '33139': 'Miami Beach',
  '33140': 'Miami Beach',
  '33141': 'Miami Beach',
  '33142': 'Miami',
  '33143': 'Miami',
  '33144': 'Miami',
  '33145': 'Miami',
  '33146': 'Coral Gables',
  '33147': 'Miami',
  '33150': 'El Portal',
  '33154': 'Surfside',
  '33155': 'Miami',
  '33156': 'Miami',
  '33157': 'Cutler Bay',
  '33160': 'Aventura',
  '33161': 'North Miami',
  '33162': 'North Miami Beach',
  '33165': 'Miami',
  '33166': 'Miami Springs',
  '33167': 'Miami',
  '33168': 'North Miami',
  '33169': 'Miami Gardens',
  '33170': 'Miami',
  '33172': 'Doral',
  '33173': 'Miami',
  '33174': 'Miami',
  '33175': 'Miami',
  '33176': 'Miami',
  '33177': 'Miami',
  '33178': 'Doral',
  '33179': 'Miami',
  '33180': 'Aventura',
  '33181': 'North Miami Beach',
  '33182': 'Miami',
  '33183': 'Miami',
  '33184': 'Miami',
  '33185': 'Miami',
  '33186': 'Miami',
  '33187': 'Miami',
  '33189': 'Cutler Bay',
  '33190': 'Cutler Bay',
  '33193': 'Miami',
  '33194': 'Miami',
  '33196': 'Miami',
  '33296': 'Miami',
  '33306': 'Fort Lauderdale',
  '33309': 'Fort Lauderdale',
  '33312': 'Fort Lauderdale',
  '33313': 'Sunrise',
  '33314': 'Davie',
  '33326': 'Weston',
  '33321': 'Tamarac',
  '33334': 'Oakland Park',
  '33351': 'Sunrise',
  '33461': 'Lake Worth',
  '33405': 'West Palm Beach',
  '33462': 'Lake Worth',
  '33463': 'Lake Worth',
  '33480': 'Palm Beach',
  '33487': 'Boca Raton',
  '33406': 'West Palm Beach',
  '33511': 'Brandon',
  '33527': 'Dover',
  '33534': 'Gibsonton',
  '33543': 'Wesley Chapel',
  '33544': 'Wesley Chapel',
  '33549': 'Lutz',
  '33558': 'Lutz',
  '33563': 'Plant City',
  '33566': 'Plant City',
  '33569': 'Riverview',
  '33570': 'Ruskin',
  '33578': 'Riverview',
  '33584': 'Seffner',
  '33594': 'Valrico',
  '33596': 'Valrico',
  '33603': 'Tampa',
  '33604': 'Tampa',
  '33606': 'Tampa',
  '33607': 'Tampa',
  '33610': 'Tampa',
  '33612': 'Tampa',
  '33613': 'Tampa',
  '33614': 'Tampa',
  '33615': 'Tampa',
  '33617': 'Tampa',
  '33619': 'Tampa',
  '33624': 'Tampa',
  '33625': 'Tampa',
  '33633': 'Tampa',
  '33634': 'Tampa',
  '33635': 'Tampa',
  '33668': 'Port Richey',
  '33647': 'Tampa',
  '33801': 'Lakeland',
  '33805': 'Lakeland',
  '33809': 'Lakeland',
  '33810': 'Lakeland',
  '33813': 'Lakeland',
  '33815': 'Lakeland',
  '33830': 'Bartow',
  '33859': 'Lake Wales',
  '33870': 'Sebring',
  '33897': 'Davenport',
  '33936': 'Lehigh Acres',
  '33971': 'Lehigh Acres',
  '33972': 'Lehigh Acres',
  '33974': 'Lehigh Acres',
  '33990': 'Cape Coral',
  '33920': 'Cape Canaveral',
  '34112': 'Naples',
  '34142': 'Immokalee',
  '34432': 'Dunnellon',
  '34470': 'Ocala',
  '34609': 'Spring Hill',
  '34652': 'Port Richey',
  '34668': 'Port Richey',
  '34683': 'Palm Harbor',
  '34691': 'Holiday',
  '34695': 'Safety Harbor',
  '34741': 'Kissimmee',
  '33709': 'St Petersburg',
  '33716': 'St Petersburg',
  '33781': 'Pinellas Park',
  '34950': 'Fort Pierce',
  '33967': 'Fort Myers',
  '34953': 'Port Saint Lucie'
});

function cleanAddressPart(value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean || null;
}

function hasUsableAddress(value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return Boolean(clean) && !EMPTY_ADDRESS_VALUES.has(clean);
}

function normalizeState(value) {
  const clean = cleanAddressPart(value);
  if (!clean) return null;
  const upper = clean.toUpperCase();
  const alias = US_STATE_ALIASES.get(upper);
  if (alias) return alias;
  return US_STATE_CODES.has(upper) ? upper : null;
}

function zipCandidates(value) {
  const clean = cleanAddressPart(value);
  if (!clean) return [];
  const exact = clean.match(/\b\d{5}(?:-\d{4})?\b/);
  if (exact) return [exact[0]];
  const longNumber = clean.match(/\b(\d{6,})(?:-\d{4})?\b/);
  if (!longNumber) return [];
  const digits = longNumber[1];
  const candidates = [];
  for (let index = 0; index <= digits.length - 5; index += 1) {
    candidates.push(digits.slice(index, index + 5));
  }
  return Array.from(new Set(candidates));
}

function cityMatches(left, right) {
  const leftCity = normalizeCityName(left);
  const rightCity = normalizeCityName(right);
  return Boolean(leftCity && rightCity && leftCity.toLowerCase() === rightCity.toLowerCase());
}

function normalizeZip(value, cityHint) {
  const clean = cleanAddressPart(value);
  if (!clean) return null;
  const candidates = zipCandidates(clean);
  if (!candidates.length) return clean;
  const byHint = cityHint
    ? candidates.find(candidate => cityMatches(FLORIDA_ZIP_CITY[candidate], cityHint))
    : null;
  return byHint || candidates.find(candidate => FLORIDA_ZIP_CITY[candidate]) || candidates[0];
}

function normalizeZip5(value, cityHint) {
  const zip = normalizeZip(value, cityHint);
  const match = zip && zip.match(/\b(\d{5})/);
  return match ? match[1] : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeCityName(value) {
  const clean = cleanAddressPart(value);
  if (!clean) return null;
  const alias = FLORIDA_CITY_ALIASES.get(clean.toUpperCase());
  if (alias) return alias;
  const known = KNOWN_FLORIDA_CITIES.find(city => city.toLowerCase() === clean.toLowerCase());
  return known || clean;
}

function isKnownCityName(value) {
  const clean = cleanAddressPart(value);
  if (!clean) return false;
  const normalized = normalizeCityName(clean);
  return cityPatterns().some(city => city.toLowerCase() === normalized.toLowerCase());
}

function getFloridaCityForZip(value, cityHint) {
  const zip5 = normalizeZip5(value, cityHint);
  return zip5 ? FLORIDA_ZIP_CITY[zip5] || null : null;
}

function isTampaRegionCity(value) {
  const city = normalizeCityName(value);
  if (!city) return false;
  return TAMPA_REGION_CITIES.some(entry => entry.toLowerCase() === city.toLowerCase());
}

function inferRegionalTagName(address, city) {
  const normalizedCity = normalizeCityName(city);
  if (normalizedCity) return isTampaRegionCity(normalizedCity) ? 'Tampa' : 'Miami';
  const parsed = hasUsableAddress(address) ? parseAddress(address) : null;
  if (parsed && parsed.city) return isTampaRegionCity(parsed.city) ? 'Tampa' : 'Miami';
  return hasUsableAddress(address) ? 'Miami' : 'None';
}

function aliasesForCity(city) {
  const canonical = normalizeCityName(city);
  if (!canonical) return [];
  const aliases = [canonical];
  for (const [alias, target] of FLORIDA_CITY_ALIASES.entries()) {
    if (target.toLowerCase() === canonical.toLowerCase()) aliases.push(alias);
  }
  return Array.from(new Set(aliases)).sort((left, right) => right.length - left.length);
}

function looksLikeStreetFragment(value) {
  const clean = cleanAddressPart(value);
  if (!clean) return false;
  const tokens = clean.toUpperCase().split(/\s+/);
  return tokens.some(token => STREET_FRAGMENT_TOKENS.has(token) || token === 'APT' || token === 'UNIT' || token === 'BLDG');
}

function cityPatterns() {
  const values = Array.from(new Set([
    ...KNOWN_FLORIDA_CITIES,
    ...Array.from(FLORIDA_CITY_ALIASES.keys()),
    ...Object.values(FLORIDA_ZIP_CITY)
  ]));
  return values.sort((left, right) => right.length - left.length);
}

function parseKnownFloridaCityZip(original) {
  const source = cleanAddressPart(original);
  if (!source) return null;
  for (const city of cityPatterns()) {
    const pattern = new RegExp('^(.*?)(?:,?\\s+)(' + escapeRegExp(city).replace(/\\ /g, '\\s+') + ')\\s*,?\\s*(?:(FL|Florida)\\s+)?(\\d{5,}(?:-\\d{4})?)$', 'i');
    const match = source.match(pattern);
    if (!match) continue;
    return {
      addressLine1: cleanAddressPart(match[1]),
      city: normalizeCityName(match[2]),
      state: normalizeState(match[3] || 'FL'),
      zipCode: normalizeZip(match[4], match[2])
    };
  }
  return null;
}

function parseKnownFloridaCityState(original) {
  const source = cleanAddressPart(original);
  if (!source) return null;
  for (const city of cityPatterns()) {
    const pattern = new RegExp('^(.*?)(?:,?\\s+)(' + escapeRegExp(city).replace(/\\ /g, '\\s+') + ')\\s*,?\\s*(FL|Florida)(?:\\s+(.*))?$', 'i');
    const match = source.match(pattern);
    if (!match) continue;
    const trailing = cleanAddressPart(match[4]);
    if (trailing && !/^(APT|UNIT|LOT|LOTE|#|EDIF|BLDG|BUILDING)/i.test(trailing)) continue;
    return {
      addressLine1: cleanAddressPart([match[1], trailing].filter(Boolean).join(' ')),
      city: normalizeCityName(match[2]),
      state: normalizeState(match[3]),
      zipCode: null
    };
  }
  return null;
}

function cleanLineAfterZipSplit(value) {
  return cleanAddressPart(String(value || '')
    .replace(/\b(F|[A-Z]?F+L+\w*|Florida)\b/gi, ' ')
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s+/g, ' '));
}

function parseZipReferencedAddress(original) {
  const source = cleanAddressPart(original);
  if (!source) return null;

  for (const city of cityPatterns()) {
    const pattern = new RegExp('^(.*?)(' + escapeRegExp(city).replace(/\\ /g, '\\s+') + ')\\s*,?\\s*(?:(F|[A-Z]?F+L+\\w*|Florida)\\s*)?(\\d{5,})(?:-\\d{4})?\\b(.*)$', 'i');
    const match = source.match(pattern);
    if (!match) continue;
    const zipCode = normalizeZip(match[4], match[2]);
    const zipCity = getFloridaCityForZip(zipCode, match[2]);
    return {
      addressLine1: cleanAddressPart([cleanLineAfterZipSplit(match[1]), cleanLineAfterZipSplit(match[5])].filter(Boolean).join(' ')),
      city: zipCity || normalizeCityName(match[2]),
      state: normalizeState(match[3] || 'FL') || 'FL',
      zipCode
    };
  }

  const zipMatches = Array.from(source.matchAll(/\b(\d{5,})(?:-\d{4})?\b/g));
  const zipMatch = zipMatches.find(match => getFloridaCityForZip(normalizeZip(match[1]))) || null;
  if (!zipMatch) return null;
  const zipCode = normalizeZip(zipMatch[1]);
  const zipCity = getFloridaCityForZip(zipCode);
  if (!zipCity) return null;
  const line1 = cleanLineAfterZipSplit(source.replace(zipMatch[0], ' '));
  return {
    addressLine1: line1,
    city: zipCity,
    state: 'FL',
    zipCode
  };
}

function splitKnownFloridaCityFromStreet(addressLine1, state, zipCode) {
  const source = cleanAddressPart(addressLine1);
  if (!source || !normalizeZip(zipCode)) return null;
  const zipCity = getFloridaCityForZip(zipCode);
  const candidates = zipCity ? aliasesForCity(zipCity) : cityPatterns();
  for (const city of candidates) {
    const pattern = new RegExp('^(.*?)(?:,?\\s+)(' + escapeRegExp(city).replace(/\\ /g, '\\s+') + ')$', 'i');
    const match = source.match(pattern);
    if (!match) continue;
    return {
      addressLine1: cleanAddressPart(match[1]),
      city: normalizeCityName(match[2]),
      state: normalizeState(state || (zipCity ? 'FL' : null) || 'FL'),
      zipCode: normalizeZip(zipCode)
    };
  }
  return null;
}

function splitKnownFloridaCityFromStreetLoose(addressLine1) {
  const source = cleanAddressPart(addressLine1);
  if (!source) return null;
  for (const city of cityPatterns()) {
    const pattern = new RegExp('^(.*?)(?:,?\\s+)(' + escapeRegExp(city).replace(/\\ /g, '\\s+') + ')$', 'i');
    const match = source.match(pattern);
    if (!match) continue;
    const line1 = cleanAddressPart(match[1]);
    if (!line1 || line1.length < 3) continue;
    return {
      addressLine1: line1,
      city: normalizeCityName(match[2]),
      state: 'FL',
      zipCode: null
    };
  }
  return null;
}

function cleanAddressCityWithZipReference(parts) {
  const data = parts || {};
  const zipCity = getFloridaCityForZip(data.zipCode, data.city);
  if (!zipCity) return null;

  const fromStreet = splitKnownFloridaCityFromStreet(data.addressLine1, data.state, data.zipCode);
  if (fromStreet && fromStreet.city.toLowerCase() === zipCity.toLowerCase()) return fromStreet;

  const currentCity = cleanAddressPart(data.city);
  if (!currentCity) {
    return {
      addressLine1: cleanAddressPart(data.addressLine1),
      city: zipCity,
      state: normalizeState(data.state) || 'FL',
      zipCode: normalizeZip(data.zipCode)
    };
  }
  const rawState = cleanAddressPart(data.state);
  const rawStateUpper = rawState ? rawState.toUpperCase() : null;
  const currentState = normalizeState(data.state);
  const canonicalCurrentCity = normalizeCityName(currentCity);
  if (
    currentCity &&
    canonicalCurrentCity &&
    canonicalCurrentCity.toLowerCase() === zipCity.toLowerCase() &&
    currentState !== rawStateUpper
  ) {
    return {
      addressLine1: cleanAddressPart(data.addressLine1),
      city: zipCity,
      state: currentState || 'FL',
      zipCode: normalizeZip(data.zipCode)
    };
  }
  const exactCity = normalizeCityName(currentCity);
  const line1 = cleanAddressPart(data.addressLine1);
  const line1Tokens = line1 ? line1.split(/\s+/) : [];
  const trailingLine1Token = line1Tokens[line1Tokens.length - 1];
  if (trailingLine1Token && zipCity) {
    const combinedCity = normalizeCityName([trailingLine1Token, currentCity].join(' '));
    if (combinedCity && combinedCity.toLowerCase() === zipCity.toLowerCase()) {
      return {
        addressLine1: cleanAddressPart(line1Tokens.slice(0, -1).join(' ')),
        city: zipCity,
        state: normalizeState(data.state) || 'FL',
        zipCode: normalizeZip(data.zipCode)
      };
    }
  }
  if (currentCity && exactCity && exactCity.toLowerCase() !== currentCity.toLowerCase()) {
    return {
      addressLine1: cleanAddressPart(data.addressLine1),
      city: exactCity,
      state: normalizeState(currentState || 'FL'),
      zipCode: normalizeZip(data.zipCode)
    };
  }
  if (currentCity) {
    const cityWithoutState = cleanAddressPart(currentCity.replace(/\s+FL$/i, ''));
    for (const alias of aliasesForCity(zipCity)) {
      const pattern = new RegExp('^(.*?)(?:\\s+)?(' + escapeRegExp(alias).replace(/\\ /g, '\\s+') + ')$', 'i');
      const match = cityWithoutState.match(pattern);
      if (!match) continue;
      const prefix = cleanAddressPart(match[1]);
      return {
        addressLine1: cleanAddressPart([data.addressLine1, prefix].filter(Boolean).join(' ')),
        city: zipCity,
        state: normalizeState(data.state) || 'FL',
        zipCode: normalizeZip(data.zipCode)
      };
    }
    for (const city of cityPatterns()) {
      const pattern = new RegExp('^(.*?)(?:\\s+)?(' + escapeRegExp(city).replace(/\\ /g, '\\s+') + ')$', 'i');
      const match = cityWithoutState.match(pattern);
      if (!match) continue;
      const prefix = cleanAddressPart(match[1]);
      return {
        addressLine1: cleanAddressPart([data.addressLine1, prefix].filter(Boolean).join(' ')),
        city: normalizeCityName(match[2]),
        state: 'FL',
        zipCode: normalizeZip(data.zipCode)
      };
    }
  }

  if (currentCity && rawStateUpper && STREET_FRAGMENT_TOKENS.has(rawStateUpper)) {
    return {
      addressLine1: cleanAddressPart([data.addressLine1, currentCity, rawStateUpper].filter(Boolean).join(' ')),
      city: zipCity,
      state: 'FL',
      zipCode: normalizeZip(data.zipCode)
    };
  }

  if (currentCity && looksLikeStreetFragment(currentCity)) {
    return {
      addressLine1: cleanAddressPart([data.addressLine1, currentCity].filter(Boolean).join(' ')),
      city: zipCity,
      state: normalizeState(data.state) || 'FL',
      zipCode: normalizeZip(data.zipCode)
    };
  }

  if (currentCity && !isKnownCityName(currentCity) && /^\d+[A-Za-z]?$/i.test(cleanAddressPart(data.addressLine1) || '')) {
    return {
      addressLine1: cleanAddressPart([data.addressLine1, currentCity].filter(Boolean).join(' ')),
      city: zipCity,
      state: normalizeState(data.state) || 'FL',
      zipCode: normalizeZip(data.zipCode)
    };
  }

  return null;
}

function cleanAddressCityWithKnownCitySuffix(parts) {
  const data = parts || {};
  const currentCity = cleanAddressPart(data.city);
  const currentState = normalizeState(data.state);
  if (!currentCity || !currentState) return null;

  const exactCity = normalizeCityName(currentCity);
  if (exactCity && exactCity.toLowerCase() !== currentCity.toLowerCase()) {
    return {
      addressLine1: cleanAddressPart(data.addressLine1),
      city: exactCity,
      state: currentState,
      zipCode: normalizeZip(data.zipCode)
    };
  }

  const cityWithoutState = cleanAddressPart(currentCity.replace(/\s+(FL|PA|Florida|Pennsylvania)$/i, ''));
  for (const city of cityPatterns()) {
    const pattern = new RegExp('^(.*?)(?:\\s+)?(' + escapeRegExp(city).replace(/\\ /g, '\\s+') + ')$', 'i');
    const match = cityWithoutState.match(pattern);
    if (!match) continue;
    const prefix = cleanAddressPart(match[1]);
    return {
      addressLine1: cleanAddressPart([data.addressLine1, prefix].filter(Boolean).join(' ')),
      city: normalizeCityName(match[2]),
      state: currentState,
      zipCode: normalizeZip(data.zipCode)
    };
  }

  return null;
}

function normalizeStructuredAddressForReference(parts) {
  const data = parts || {};
  const current = {
    addressLine1: cleanAddressPart(data.addressLine1),
    city: normalizeCityName(data.city),
    state: normalizeState(data.state),
    zipCode: normalizeZip(data.zipCode, data.city)
  };
  const parsed = parseAddress(data.address || data.addressLine1 || '');
  let best = cleanAddressCityWithZipReference(parsed) || parsed;
  best = cleanAddressCityWithKnownCitySuffix(best) || best;
  if (!best.city && !best.state && !best.zipCode && current.addressLine1) {
    best = { ...best, addressLine1: current.addressLine1 };
  }
  const merged = {
    addressLine1: best.addressLine1 || current.addressLine1,
    city: best.city || current.city,
    state: best.state || current.state,
    zipCode: best.zipCode || current.zipCode
  };
  best = cleanAddressCityWithZipReference(merged) || best;
  best = cleanAddressCityWithKnownCitySuffix({
    addressLine1: best.addressLine1 || current.addressLine1,
    city: best.city || current.city,
    state: best.state || current.state,
    zipCode: best.zipCode || current.zipCode
  }) || best;
  if ((!best.city || !best.state) && best.addressLine1 && !best.zipCode) {
    best = splitKnownFloridaCityFromStreetLoose(best.addressLine1) || best;
  }
  return {
    addressLine1: cleanAddressPart(best.addressLine1) || current.addressLine1,
    city: normalizeCityName(best.city) || current.city,
    state: normalizeState(best.state) || current.state,
    zipCode: normalizeZip(best.zipCode) || current.zipCode
  };
}

function composeAddress(parts) {
  parts = parts || {};
  const line1 = cleanAddressPart(parts.addressLine1);
  const city = cleanAddressPart(parts.city);
  const state = normalizeState(parts.state);
  const zipCode = normalizeZip(parts.zipCode);
  const cityStateZip = [
    city,
    [state, zipCode].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ');
  return [line1, cityStateZip].filter(Boolean).join(', ') || null;
}

function parseAddress(address) {
  const original = cleanAddressPart(address);
  if (!hasUsableAddress(original)) {
    return { addressLine1: null, city: null, state: null, zipCode: null };
  }

  const commaParts = original.split(',').map(cleanAddressPart).filter(Boolean);
  const knownCityZip = parseKnownFloridaCityZip(original);
  if (knownCityZip) return knownCityZip;
  const zipReferenced = parseZipReferencedAddress(original);
  if (zipReferenced) return zipReferenced;
  const knownCityState = parseKnownFloridaCityState(original);
  if (knownCityState) return knownCityState;
  const knownCitySuffix = splitKnownFloridaCityFromStreetLoose(original);
  if (knownCitySuffix) return knownCitySuffix;

  if (commaParts.length >= 2) {
    const last = commaParts[commaParts.length - 1];
    const stateZip = last.match(/^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
    if (stateZip) {
      return {
        addressLine1: commaParts.slice(0, -2).join(', ') || commaParts[0] || null,
        city: commaParts[commaParts.length - 2] || null,
        state: normalizeState(stateZip[1]),
        zipCode: normalizeZip(stateZip[2])
      };
    }
    const cityStateZip = last.match(/^(.+?)\s+([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
    if (cityStateZip) {
      return {
        addressLine1: commaParts.slice(0, -1).join(', ') || null,
        city: cleanAddressPart(cityStateZip[1]),
        state: normalizeState(cityStateZip[2]),
        zipCode: normalizeZip(cityStateZip[3])
      };
    }
  }

  const trailing = original.match(/^(.*?)(?:,?\s+)([A-Za-z][A-Za-z .'-]+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (trailing) {
    const state = normalizeState(trailing[3]);
    if (!state && STREET_FRAGMENT_TOKENS.has(String(trailing[3] || '').toUpperCase())) {
      return {
        addressLine1: cleanAddressPart([trailing[1], trailing[2], trailing[3]].filter(Boolean).join(' ')),
        city: null,
        state: null,
        zipCode: normalizeZip(trailing[4])
      };
    }
    return {
      addressLine1: cleanAddressPart(trailing[1]),
      city: cleanAddressPart(trailing[2]),
      state,
      zipCode: normalizeZip(trailing[4], trailing[2])
    };
  }

  return { addressLine1: original, city: null, state: null, zipCode: null };
}

function normalizeAddressPayload(payload) {
  const data = payload || {};
  const hasStructured = ['addressLine1', 'city', 'state', 'zipCode'].some(field => Object.prototype.hasOwnProperty.call(data, field));
  const parsed = hasStructured ? {} : parseAddress(data.address);
  const parts = normalizeStructuredAddressForReference({
    address: data.address,
    addressLine1: cleanAddressPart(hasStructured ? data.addressLine1 : parsed.addressLine1),
    city: cleanAddressPart(hasStructured ? data.city : parsed.city),
    state: normalizeState(hasStructured ? data.state : parsed.state),
    zipCode: normalizeZip(hasStructured ? data.zipCode : parsed.zipCode, hasStructured ? data.city : parsed.city)
  });
  const address = hasStructured
    ? (cleanAddressPart(data.address) || composeAddress(parts))
    : (cleanAddressPart(data.address) || composeAddress(parts));
  return { ...parts, address };
}

module.exports = {
  TAMPA_REGION_CITIES,
  cleanAddressPart,
  composeAddress,
  hasUsableAddress,
  normalizeAddressPayload,
  normalizeState,
  normalizeStructuredAddressForReference,
  parseAddress,
  splitKnownFloridaCityFromStreet,
  splitKnownFloridaCityFromStreetLoose,
  cleanAddressCityWithZipReference,
  cleanAddressCityWithKnownCitySuffix,
  getFloridaCityForZip,
  inferRegionalTagName,
  isKnownCityName,
  normalizeCityName
};
