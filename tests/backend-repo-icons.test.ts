import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {selectLogoCandidates,ownerAvatarUrl,boundedBytes,rasterizeIcon,hasLogoContrast,MAX_IMAGE_BYTES,type GitTreeEntry} from '../lib/repo-icons';
const blob=(path:string,size=100):GitTreeEntry=>({path,size,type:'blob',sha:'a'.repeat(40),mode:'100644'});
test('repo logo ranking prefers project branding over general icons and docs',()=>{
 const entries=['public/favicon.png','docs/assets/logo.svg','src-tauri/icons/icon.png','assets/logo-light.svg','logo.png'].map(path=>blob(path));
 assert.deepEqual(selectLogoCandidates(entries).map(e=>e.path),['logo.png','assets/logo-light.svg','docs/assets/logo.svg']);
});
test('logo ranking excludes light-background invisible images, dependencies, test assets, symlinks, oversized files and badges',()=>{
 const entries=['logo-white.svg','node_modules/pkg/logo.png','vendor/logo.png','test/fixtures/logo.png','docs/screenshots/logo.png','badges/logo.svg','logo-test.png','logo-example.svg'].map(path=>blob(path));
 entries.push(blob('logo.png',MAX_IMAGE_BYTES+1),{...blob('public/icon.png'),mode:'120000'},{...blob('logo-light.png'),sha:'../unsafe'},blob('public/icon-192.png'));
 assert.deepEqual(selectLogoCandidates(entries).map(e=>e.path),['public/icon-192.png']);
});
test('candidate selection is stable and never returns more than three blobs',()=>{
 const entries=['public/logo.svg','public/logo.png','public/logo.webp','assets/logo.png'].map(path=>blob(path));
 assert.equal(selectLogoCandidates(entries,20).length,3);assert.deepEqual(selectLogoCandidates(entries),selectLogoCandidates([...entries].reverse()));
});
test('owner avatar URL cannot be redirected through a crafted owner',()=>{
 assert.equal(ownerAvatarUrl('miskibin'),'https://avatars.githubusercontent.com/miskibin?s=192');
 for(const owner of ['../secrets','evil.example/path','evil?redirect=https://localhost','a@127.0.0.1','a%2fb',''])assert.throws(()=>ownerAvatarUrl(owner));
});
test('bounded downloads reject both oversized content-length and streamed bytes',async()=>{
 await assert.rejects(boundedBytes(new Response('hello',{headers:{'content-length':'5'}}),4));
 await assert.rejects(boundedBytes(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(5));controller.close();}})),4));
 assert.equal((await boundedBytes(new Response('ok'),4)).toString(),'ok');
});
test('SVGs become 96px PNGs; local gradients are allowed',async()=>{
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><defs><linearGradient id="x"><stop stop-color="red"/></linearGradient></defs><rect width="200" height="100" fill="url(\'#x\')"/></svg>');
 const result=await rasterizeIcon(svg);const meta=await sharp(result).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,96);assert.equal(meta.height,96);assert.equal(result.includes(Buffer.from('<svg')),false);
 const escaped=Buffer.from(svg.toString().replace("url('#x')",'url(&quot;#x&quot;)'));assert.equal((await sharp(await rasterizeIcon(escaped)).metadata()).format,'png');
});
test('malicious, external-resource, entity and non-UTF8 SVGs fail safely',async()=>{
 const bodies=['<svg xmlns="http://www.w3.org/2000/svg"><image href="https://127.0.0.1/secret"/></svg>','<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>','<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>','<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:image href="file:///etc/passwd"/></s:svg>','<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:url(https://localhost)}</style></svg>'];
 for(const body of bodies)await assert.rejects(rasterizeIcon(Buffer.from(body)));
 await assert.rejects(rasterizeIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>','utf16le')));await assert.rejects(rasterizeIcon(Buffer.alloc(MAX_IMAGE_BYTES+1)));
});
test('ICO embedded PNG is decoded without sending an ICO to the browser',async()=>{
 const png=await sharp({create:{width:32,height:32,channels:4,background:'#cc5522'}}).png().toBuffer();const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=32;header[7]=32;header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
 const result=await rasterizeIcon(Buffer.concat([header,png]));assert.equal((await sharp(result).metadata()).format,'png');
});

test('white-only light variants are unsuitable for the light application canvas',async()=>{
 const white=await rasterizeIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="30" fill="white"/></svg>'));
 const dark=await rasterizeIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="30" fill="#333333"/></svg>'));
 assert.equal(await hasLogoContrast(white),false);assert.equal(await hasLogoContrast(dark),true);
});
