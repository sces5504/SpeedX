// shot-receiver.mjs — saves pictures the game page sends, so a car can be LOOKED at from a script.
//   node tools/shot-receiver.mjs            (leave it running; Ctrl+C to stop)
// The page draws several camera angles of the garage into one sheet and POSTs it here:
//   POST http://localhost:5199/<name>   (body = JPEG bytes)   ->  previews/shots/<name>.jpg
// The page side is tools/car-studio.js (a car from every angle; see its header).
// (previews/ is not committed: these are working pictures.)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const folder = 'previews/shots';
fs.mkdirSync(folder, { recursive: true });
http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  if (request.method !== 'POST') { response.end('ok'); return; }
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const name = path.basename(request.url).replace(/[^a-z0-9_.-]/gi, '_');
    fs.writeFileSync(path.join(folder, name + '.jpg'), Buffer.concat(chunks));
    console.log('saved', path.join(folder, name + '.jpg'));
    response.end('saved');
  });
}).listen(5199, '127.0.0.1', () => console.log('waiting for pictures on http://localhost:5199 -> ' + folder + '/'));
