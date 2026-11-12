/** Developer-only PIN verifier generator. Reads PIN from stdin, never prints or stores plaintext. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const path=resolve(ROOT,'config.json');
let pin='';
for await (const chunk of process.stdin) pin+=chunk.toString('utf8');
pin=pin.replace(/\r?\n$/, '');
if(!/^\d{4,12}$/.test(pin))throw new Error('PIN должен содержать 4–12 цифр. PIN не изменён.');
const conf=JSON.parse(readFileSync(path,'utf8'));
const salt=randomBytes(16),iterations=200000;
conf.trainerAccess={algorithm:'PBKDF2-SHA256',iterations,saltB64:salt.toString('base64'),verifierB64:pbkdf2Sync(pin,salt,iterations,32,'sha256').toString('base64')};
writeFileSync(path,JSON.stringify(conf,null,2)+'\n',{mode:0o644});
console.log('В config.json записаны только соль и проверочный хеш. Исходный PIN не сохранён.');
