import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
// Streaming ZIP32, stored entries, UTF-8 names and data descriptors. Files are owned pack members.
export async function* zipFiles(files){
 if(files.length>65535)throw Error('Too many ZIP entries.');
 let offset=0;const entries=[];
 for(const f of files){if(!/^[a-zA-Z0-9_./-]+$/.test(f.name)||f.name.split('/').includes('..')||f.name.startsWith('/'))throw Error('Unsafe ZIP member.');const stat=await fs.stat(f.path);if(!stat.isFile()||stat.size>0xffffffff)throw Error('ZIP member too large.');const name=Buffer.from(f.name),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x808,6);head.writeUInt16LE(name.length,26);const start=offset;yield head;yield name;offset+=head.length+name.length;let crc=0xffffffff,size=0;
 for await(const chunk of createReadStream(f.path)){for(const b of chunk)crc=table[(crc^b)&255]^(crc>>>8);size+=chunk.length;offset+=chunk.length;if(offset>0xffffffff)throw Error('ZIP exceeds ZIP32 limit.');yield chunk;}
 crc=(crc^0xffffffff)>>>0;const tail=Buffer.alloc(16);tail.writeUInt32LE(0x08074b50);tail.writeUInt32LE(crc,4);tail.writeUInt32LE(size,8);tail.writeUInt32LE(size,12);yield tail;offset+=16;entries.push({name,start,size,crc});}
 const central=offset;
 for(const e of entries){const h=Buffer.alloc(46);h.writeUInt32LE(0x02014b50);h.writeUInt16LE(20,4);h.writeUInt16LE(20,6);h.writeUInt16LE(0x808,8);h.writeUInt32LE(e.crc,16);h.writeUInt32LE(e.size,20);h.writeUInt32LE(e.size,24);h.writeUInt16LE(e.name.length,28);h.writeUInt32LE(e.start,42);yield h;yield e.name;offset+=46+e.name.length;}
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(offset-central,12);end.writeUInt32LE(central,16);yield end;
}
