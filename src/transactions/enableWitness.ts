import { TransactionPoolService } from '../services/transactionPool'
import { init } from './core'

void (async () => {
    const setup: {identity, config, ipfsClient, logger} = await init()
    await TransactionPoolService.enableWitness(setup);
    process.exit(0)
})()