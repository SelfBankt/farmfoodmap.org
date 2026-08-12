import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import fetch from 'node-fetch';

console.log(
  'Running script to fetch all the farm shops in the world!\nPlease be patient...'
);
try {
  const q = `[out:json];node[shop=farm](-90,-180,90,180);out body;>;out skel qt;`;
  const address =
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter?data=';
  const r = await fetch(address + encodeURIComponent(q));
  const j = await r.json();
  const qM = `[out:json];node["amenity"="marketplace"]["shop"="market"](-90,-180,90,180);out body;>;out skel qt;`;
  const rM = await fetch(address + encodeURIComponent(qM));
  console.log('Response received. Now Processing...');
  const jM = await rM.json();
  const joined = [...jM.elements, ...j.elements];
  const mapData = {};
  if (!joined.length) {
    console.log('joined :>> ', joined);
    throw new Error('Unknown response from server');
  }
  const allowed = [
    'shop',
    'amenity',
    'name',
    'addr:housename',
    'addr:housenumber',
    'addr:floor',
    'addr:street',
    'addr:suburb',
    'addr:city',
    'addr:state',
    'addr:province',
    'addr:postcode',
    'addr:country',
    'opening_hours',
    'payment:cash',
    'payment:bitcoin',
    'currency:XBT',
    'payment:onchain',
    'payment:lightning',
    'payment:lightning_contactless',
    'organic',
    'payment:onchain',
    'phone',
    'website',
    'email',
    'facebook',
    'produce',
    'product',
    'wheelchair',
    'contact:phone',
    'contact:website',
    'contact:email',
    'contact:facebook',
    'contact:twitter',
    'contact:phone',
    'url',
    'description',
    'note',
    'wholesale',
    'drink:raw_milk',
  ];
  joined.forEach((n) => {
    if (n.id && n.lat && n.lon && n.tags) {
      const p = {
        id: parseInt(n.id),
        lat: n.lat,
        lon: n.lon,
        tags: Object.keys(n.tags)
          .filter((key) => allowed.includes(key))
          .reduce((obj, key) => {
            obj[key] = n.tags[key];
            return obj;
          }, {}),
      };
      mapData[`id${p.id}`] = p;
    } else {
      console.log('n :>> ', n);
    }
  });
  const data = new Uint8Array(Buffer.from(JSON.stringify(mapData)));
  await writeFile('./src/globalData.json', data);
  console.log('Success!');
} catch (error) {
  console.error(`ERROR:>> `, error);
}
