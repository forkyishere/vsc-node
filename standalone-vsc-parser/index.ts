import { mongo } from "mongoose"
import { ChainStateLib, IChainStateLib, IChainStateLibConfig } from "../chainstate-lib/ChainStateLib"
import { MongoClient } from "mongodb"
import * as IPFSHTTP from "kubo-rpc-client";
import { Ed25519Provider } from "key-did-provider-ed25519";
import KeyResolver from 'key-did-resolver'
import winston from "winston";
import { DID } from "dids";
import * as fs from 'fs';
import _get from 'dlv';

class Config implements IChainStateLibConfig {
    config: any;

    constructor(configPath: string) {
        this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    get(key) {
        if (typeof key === 'undefined') {
          return this.config
        }
        if (typeof key !== 'string') {
          return new Error('Key ' + key + ' must be a string.')
        }
        return _get(this.config, key)
      }
}

async function startup(): Promise<void> {
    const config = new Config(process.env.CONFIG_PATH)

    const mongoClient = new MongoClient(process.env.MONGO_HOST || '127.0.0.1:27017')
    const db = mongoClient.db('vsc')

    const ipfs = IPFSHTTP.create({ url: process.env.IPFS_HOST || config.get('ipfs.apiAddr') || '127.0.0.1:5001'});

    const privateKey = config.get('identity.walletPrivate');
    if(!privateKey) {
        throw new Error("No identity found. Please initialize a daemon")
    }
    const keyPrivate = new Ed25519Provider(Buffer.from(privateKey, 'base64'))
    const identity = new DID({ provider: keyPrivate, resolver: KeyResolver.getResolver() })

    const logger = winston.createLogger()

    const chainStateLib: IChainStateLib = new ChainStateLib(db, ipfs, identity, logger)

    chainStateLib.setConfig(config)

    chainStateLib.chainParserHIVE.start()
    chainStateLib.chainParserVSC.start()
}

void startup()

process.on('unhandledRejection', (error: Error) => {
    console.log('unhandledRejection', error)
})
  