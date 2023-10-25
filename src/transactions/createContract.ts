import * as fs from 'fs';
import { TransactionPoolService } from '../services/transactionPool';
import { init } from './core';

void (async () => {
    
    const name = process.argv[2]
    const description = process.argv[3]
    const execPath = process.argv[4]

    // sample usage
    // node --experimental-specifier-resolution=node --loader ts-node/esm src/transactions/createContract.ts testname "test description" src/services/contracts/basic-contract.js
    const setup: {identity, config, ipfsClient, logger} = await init()

    if(!execPath) {
        setup.logger.info('Usage: createContract.ts <name of contract> <description of contract e.g.: "..."> <path to contract>')
        process.exit(0)
    }

    let code = ""
    try {
        const data = fs.readFileSync(execPath, 'utf8');
        code = data
    } catch (err) {
        setup.logger.error('not able to load contract file:\n', err);
        process.exit(0)
    }

    await TransactionPoolService.createContract({
            name: name,
            code: code,
            description: description
        },
        setup);
    
    process.exit(0)
})()