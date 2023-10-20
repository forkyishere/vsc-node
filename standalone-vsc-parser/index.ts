import { mongo } from "mongoose"
import { ChainStateLib, IChainStateLib } from "../chainstate-lib/ChainStateLib"
import { MongoClient } from "mongodb"
import * as IPFSHTTP from "kubo-rpc-client";
import { Ed25519Provider } from "key-did-provider-ed25519";
import KeyResolver from 'key-did-resolver'
import winston from "winston";
import { DID } from "dids";

async function startup(): Promise<void> {
    const mongoClient = new MongoClient(process.env.MONGO_HOST || '127.0.0.1:27017')
    const db = mongoClient.db('vsc')
    
    const ipfs = IPFSHTTP.create({ url: process.env.IPFS_HOST || '127.0.0.1:5001'});

    // TODONEW implement config system
    const privateKey = ''; 
    if(!privateKey) {
        throw new Error("No identity found. Please initialize a daemon")
    }
    const keyPrivate = new Ed25519Provider(Buffer.from(privateKey, 'base64'))
    const identity = new DID({ provider: keyPrivate, resolver: KeyResolver.getResolver() })

    const logger = winston.createLogger()

    const chainStateLib: IChainStateLib = new ChainStateLib(db, ipfs, identity, logger)

    chainStateLib.chainParserHIVE.start()
    chainStateLib.chainParserVSC.start()
}

process.on('unhandledRejection', (error: Error) => {
    console.log('unhandledRejection', error)
})
  