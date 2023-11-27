import { DID } from "dids";
import _get from 'dlv';
import * as fs from 'fs';
import { Ed25519Provider } from "key-did-provider-ed25519";
import KeyResolver from 'key-did-resolver';
import * as IPFSHTTP from "kubo-rpc-client";
import { MongoClient } from "mongodb";
import winston from "winston";
import { ChainStateLib, IChainStateLib, IChainStateLibConfig } from "../chainstate-lib/ChainStateLib";
import networks from "../src/services/networks";

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

    const mongoClient = new MongoClient(process.env.MONGO_HOST || 'mongodb://127.0.0.1:27017')
    const db = mongoClient.db('vsc')

    const ipfs = IPFSHTTP.create({ url: process.env.IPFS_HOST || config.get('ipfs.apiAddr') || '127.0.0.1:5001'});

    const privateKey = config.get('identity.walletPrivate');
    if(!privateKey) {
        throw new Error("No identity found. Please initialize a daemon")
    }
    const keyPrivate = new Ed25519Provider(Buffer.from(privateKey, 'base64'))
    const identity = new DID({ provider: keyPrivate, resolver: KeyResolver.getResolver() })

    const logger = winston.createLogger()

    const chainStateLib: IChainStateLib = new ChainStateLib()

    chainStateLib.init(config, db, ipfs, identity, logger, networks)

    chainStateLib.chainParserHIVE.start()
    chainStateLib.chainParserVSC.start()
}

void startup()

process.on('unhandledRejection', (error: Error) => {
    console.log('unhandledRejection', error)
})
  