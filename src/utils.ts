
import EventEmitter from 'events'
//import PQueue from 'p-queue'
import { BlockchainMode, BlockchainStreamOptions, Client } from '@hiveio/dhive'
import Pushable from 'it-pushable'
import { DagJWS, DID } from 'dids'
import PQueue from 'p-queue'
import { IPFSHTTPClient } from 'kubo-rpc-client'
import winston from 'winston'
import Axios from 'axios'
import { getLogger } from './logger'

export const OFFCHAIN_HOST = process.env.OFFCHAIN_HOST || "https://us-01.infra.3speak.tv/v1/graphql"

/**
 * New block streaming utiziling batch requests (if available)
 * Improves stability and speed of block streaming
 */
// export class fastStreamV2 {
//   constructor() {

//   }

//   private async testAPIs() {
//     const API_LIST = [
//       'https://techcoderx.com',
//       'https://api.openhive.network',
//     ]

//     const testedAPIs = []
//     for(let api of API_LIST) {

      
//     }
//   }

//   async start() {

//   }
// }
  
export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
  

export const NULL_DID = 'did:key:z6MkeTG3bFFSLYVU7VqhgZxqr6YzpaGrQtFMh1uvqGy1vDnP' // Null address should go to an empty ed25519 key


export async function verifyMultiJWS(dagJws: DagJWS, signer: DID) {
  let auths = []; 

  for(let sig of dagJws.signatures) {
    const obj = {
      signatures: [sig],
      payload: dagJws.payload,
    }
    const {kid} = await signer.verifyJWS(obj)
    
    auths.push(kid.split('#')[0])
  }

  return {
    payload: dagJws.payload,
    auths
  }
}

export async function createJwsMultsign(data: any, signers: DID[]) {
  let signatures = []
  let signedDag
  for (let signer of signers) {
    signedDag = await signer.createJWS(data)
    let d = await signer.createDagJWS(data)
    // console.log('signedDag', signedDag, d.jws)
    signatures.push(...signedDag.signatures)
  }
  // let signatures = []
  // let signedDag
  // for(let signer of signers) {
  //   signedDag = await signer.createDagJWS(output)
  //   // console.log('signedDag', signedDag)
  //   signatures.push(...signedDag.jws.signatures)
  // }

  // let completeDag = {
  //   jws: {
  //     payload: signedDag.jws.payload,
  //     signatures,
  //     link: signedDag.jws.link
  //   },
  //   linkedBlock: await this.self.ipfs.block.put(signedDag.linkedBlock, {
  //     format: 'dag-cbor'
  //   })
  // }
  return {
    payload: signedDag.payload,
    signatures,
    // link: signedDag.jws.link,
  }
}

export class Benchmark {
  startTime: Date
  stages: Record<string, {
    name: string,
    value: Date
  }>
  stageNum: number
  constructor() {
    this.startTime = new Date();
    this.stages = {}
    this.stageNum = 1;
  }

  stage(name: string) {
    this.stages[this.stageNum] = {
      value: new Date(),
      name
    }
    this.stageNum = this.stageNum + 1;
  }
}

export class BenchmarkContainer {
  benchmarks: Record<string, Benchmark>
  benchmarkCount: number
  logger: winston.Logger

  constructor() {
    this.benchmarks = {
      
    }
    this.benchmarkCount = 0;

    this.logger = getLogger({
      prefix: 'benchmark container',
      printMetadata: true,
      level: 'debug',
    })
  }
  table() {
    const table = {}
    const table2 = {}
    for(let bench of Object.values(this.benchmarks)) {
      for(let [key, value] of Object.entries(bench.stages)) {
        if(!table[key]) {
          table[key] = {
            value: 0,
            name: value.name
          }
        }
        table[key].value = (table[key].value) + (value.value.getTime() - bench.startTime.getTime())
        if(!table2[key]) {
          table2[key] = []
        }
        table2[key].push(value.value.getTime() - bench.startTime.getTime())
      }
    }
    for(let [key, value] of Object.entries(table)) {
      table[key] = {value: (value as any).value /  this.benchmarkCount, name: (value as any).name}
    }
    this.logger.info('benchmark infos', table)
  }
  createInstance() {
    const bench = new Benchmark();
    this.benchmarkCount = this.benchmarkCount + 1
    this.benchmarks[this.benchmarkCount] = bench
    return bench;
  } 
}


export async function getCommitHash() {
  const fsPromise = await import('fs/promises'); //Modular import
  let buf
  try {
    buf = await fsPromise.readFile('./.git/refs/heads/main')
  } catch {
    try {
      buf = await fsPromise.readFile('/root/git_commit')
    } catch {
  
    }
  }

  return buf.toString();
}

export function calcBlockInterval(options: {
  currentBlock: number,
  intervalLength: number,
  marginLength?: number
}) {

  const {currentBlock, intervalLength} = options;

  const currentMod = currentBlock % intervalLength
  const last = currentBlock - currentMod

  return {
    next: currentBlock + (intervalLength - currentMod),
    last,
    currentMod,
    isActive: currentMod === 0,
    isMarginActive: options.marginLength ? currentMod < options.marginLength : false
  }
}

export function median (arr) {
    const mid = Math.floor(arr.length / 2),
      nums = [...arr].sort((a, b) => a - b);
    return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  };


  
export class ModuleContainer {
  modules: Array<any>;
  moduleList: Array<string>
  moduleName: string;
  parentRegFunc: Function
  constructor(name) {
    this.moduleName = name;
    // this.moduleName = moduleName
    this.modules = []
    this.moduleList = []
  }

  regNames() {
    for(let [key, regClass] of this.modules) {
      this.moduleList.push(`${regClass.moduleName}`);
      this.moduleList.push(...(regClass?.moduleList || []).map(e => {
        return `${key}.${e}`
      }))
    }
  }

  regModule(name, regClass) {
    regClass.moduleName = `${this.moduleName}.${name}`
    this.modules.push([name, regClass])
  }


  async startModules() {
      let startStack = [ ]
      for(let [key, regClass] of this.modules) {
          if(regClass.start) {
              try {
                  console.log('starting', regClass.moduleName)
                  await regClass.start()
              } catch (ex) {
                  startStack.push(key, ex)
              }
          }
      }
      return startStack;
  }

  async stopModules() {
      let stopStack = [ ]
      for(let [key, regClass] of this.modules) {
          if(regClass.stop) {
              try {
                  await regClass.stop()
              } catch (ex) {
                  stopStack.push(key, ex)
              }
          }
      }
      return stopStack;
  }
  lsModules(prefix: string, recursive: true) {
    
    if(recursive) {
      return this.modules.map(([key,e]) => {
        return [[key,e], e.lsModules()]
      });
    } else {
      return this.modules.map(([key,e]) => {
        
        return [key]
      });
    }

    // if(recursive) {
    //   return this.modules.map(([,e]) => {
    //     let obj
    //     if(e.lsModules) {
    //       console.log('running')
    //       obj = e.lsModules(prefix)
    //     }
    //     console.log('obj is', obj)
    //     return obj
    //   });
    // } else {
    //   return this.modules.map(([,e]) => {
    //     return [`${prefix}.${e.moduleName}`, [], e.lsModules]
    //   });
    // }

    //   const modules = this.modules.map(e => {
    //       if(prefix) {
    //           return [`${prefix}.${e[0]}`, e[1]]
    //       } else {
    //           return [e[0], e[1]];
    //       }
    //   });
      
    //   if(recursive) {
    //     const mods = modules.map(([key, reg])=> {
    //       let key2 = `${prefix}.${key}`
    //         if(reg.lsModules) {
    //           return [key2, reg.lsModules(key2, true, true)]
    //         } else {
    //           return [key2, []]
    //         }
    //     })
    //     if(inR) {
    //       return modules.map(e => e)
    //     } else {
    //       return modules.map(e => e[0])[0]
    //     }
    //   }
    // if(inR) {
    //   return modules.map(e => e)
    // } else {
    //   return modules.map(e => e[0])
    // }
  }
}