import EventEmitter from 'events'
//import PQueue from 'p-queue'
import { Client } from '@hiveio/dhive'
import Axios from 'axios'
import Pushable from 'it-pushable'
import PQueue from 'p-queue'
import winston from 'winston'
import { ChainStateLib, IChainStateLib, ILogger } from './ChainStateLib'

const HIVE_API = process.env.HIVE_HOST || 'https://hive-api.web3telekom.xyz'

export const HiveClient = new Client(process.env.HIVE_HOST || [HIVE_API, 'https://api.deathwing.me', 'https://anyx.io', 'https://api.openhive.network', 'https://rpc.ausbit.dev'])

export class FastStream {

    replayComplete: boolean
    blockMap: Record<string, any>

    eventQueue: NodeJS.Timer
    events: EventEmitter
    streamPaused: boolean
    streamOut: Pushable.Pushable<any>
    currentBlock: number
    startBlock: number
    parser_height: number
    endSet: number
    setSize: number
    queue: PQueue
    headHeight: number
    headTracker: NodeJS.Timer
    finalStream: NodeJS.ReadableStream
    lastBlockAt: Date
    lastBlock: number
    lastBlockTs: Date
    aborts: Array<AbortController>
    logger: ILogger;

    constructor(logger: ILogger, queue: PQueue, streamOpts: {
        startBlock: number,
        endBlock?: number
        trackHead?: boolean
    }) {
        this.logger = logger;
        this.queue = queue
        this.events = new EventEmitter()
        this.streamOut = Pushable()
        this.lastBlock = streamOpts.startBlock || 1
        this.startBlock = streamOpts.startBlock || 1
        this.parser_height = streamOpts.startBlock || 0
        this.setSize = 50;
        this.endSet = (streamOpts.endBlock - streamOpts.startBlock) / this.setSize

        this.blockMap = {}
        this.aborts = []

        this.startStream = this.startStream.bind(this)
        this.resumeStream = this.resumeStream.bind(this)
        this.pauseStream = this.pauseStream.bind(this)
        this.onDone = this.onDone.bind(this)

        this.events.on('block', (block_height, block) => {
            this.streamOut.push([block_height, block])
        })

        this.eventQueue = setInterval(() => {
            if (this.blockMap[this.parser_height]) {
                const block_height = parseInt(this.blockMap[this.parser_height].block_id.slice(0, 8), 16)

                this.parser_height = block_height + 1;
                this.events.emit('block', block_height, this.blockMap[block_height])
                this.lastBlockAt = new Date()
                this.lastBlock = block_height;
                this.lastBlockTs = new Date(this.blockMap[block_height].timestamp + "Z")
                delete this.blockMap[block_height]
            }
            for (let key of Object.keys(this.blockMap)) {
                if (Number(key) < this.parser_height) {
                    delete this.blockMap[key]; //Memory safety
                }
            }
        }, 1)
    }

    get calcHeight() {
        if (this.lastBlock && this.lastBlockTs) {
            const ts = new Date().getTime()

            const diff = Math.floor((ts - this.lastBlockTs.getTime()) / 3_000)

            return this.lastBlock + diff;
        } else {
            return null;
        }
    }

    get blockLag() {
        //Simulated blockLag

        if (this.lastBlock && this.lastBlockTs) {
            const ts = new Date().getTime()

            const diff = Math.floor((ts - this.lastBlockTs.getTime()) / 3_000)

            return diff
        } else {
            return null;
        }
    }

    async startStream() {

        this.headTracker = setInterval(async () => {
            const currentBlock = await HiveClient.blockchain.getCurrentBlock()
            console.log(`headTracker: currentBlock=${typeof currentBlock === 'object' ? parseInt(currentBlock.block_id.slice(0, 8), 16) : currentBlock}`)
            if (currentBlock) {
                this.headHeight = parseInt(currentBlock.block_id.slice(0, 8), 16)
            }

        }, 3000)

        let activeLength = 0
        let finalBlock;
        if (this.endSet > 1) {
            for (let x = 0; x <= this.endSet; x++) {
                // console.log('101', x)
                // console.log('this.endSet', this.endSet)
                this.queue.add(async () => {
                    const blocks = await streamHiveBlocks(HIVE_API, {
                        count: this.setSize,
                        start_block: this.startBlock + x * this.setSize
                    })
                    console.log('this.lastBlock', this.lastBlock, {
                        count: this.setSize,
                        start_block: this.startBlock + x * this.setSize,
                        blockMapSize: Object.keys(this.blockMap).length
                    })
                    // this.currentBlock = this.currentBlock + this.setSize

                    for (let block of blocks) {
                        // console.log(block)
                        const block_height = parseInt(block.block_id.slice(0, 8), 16)
                        // console.log(this.parser_height, block_height)
                        if (this.parser_height === block_height) {
                            this.parser_height = block_height + 1;

                            this.events.emit('block', block_height, block)
                            this.lastBlockAt = new Date()
                            this.lastBlock = block_height;
                            this.lastBlockTs = new Date(block.timestamp + "Z")
                        } else if (block_height > this.parser_height) {
                            this.blockMap[block_height] = block
                        }
                    }
                })
                await this.queue.onSizeLessThan(5)
            }
            await this.queue.onIdle();
        }
        this.logger.debug("ITS IDLE", {
            finalBlock
        })

        const controller = new AbortController();
        const signal = controller.signal;

        this.aborts.push(controller)
        try {
            for await (let block of liveHiveBlocks(HIVE_API, {
                start_block: this.parser_height,
                signal
            })) {
                const block_height = parseInt(block.block_id.slice(0, 8), 16)
                if (this.parser_height === block_height) {
                    this.parser_height = block_height + 1;

                    this.events.emit('block', block_height, block)
                    this.lastBlockAt = new Date()
                    this.lastBlock = block_height;
                    this.lastBlockTs = new Date(block.timestamp + "Z")
                } else if (block_height > this.parser_height) {
                    this.blockMap[block_height] = block
                }
            }
        } catch (error) {
            clearInterval(this.eventQueue as any)
            this.streamOut.end(error)
        }
    }

    async resumeStream() {
        this.streamPaused = true
    }

    async pauseStream() {
        this.streamPaused = false
        this.events.emit('unpause')
    }

    async killStream() {
        clearInterval(this.eventQueue as any)
        clearInterval(this.headTracker as any)
        this.streamOut.end()
        this.queue.clear()
        this.aborts.forEach((e) => {
            e.abort()
        })
        delete this.blockMap

    }

    async onDone() {
        await this.queue.onIdle();
    }

    static async create(logger: ILogger, streamOpts: { startBlock: number, endBlock?: number, trackHead?: boolean }) {
        const PQueue = (await import('p-queue')).default
        const queue = new PQueue({ concurrency: 2 })
        if (!streamOpts.endBlock) {
            const currentBlock = await HiveClient.blockchain.getCurrentBlock()
            const block_height = parseInt(currentBlock.block_id.slice(0, 8), 16)
            streamOpts.endBlock = block_height;
        }

        return new FastStream(logger, queue, streamOpts)
    }
}

function parseHiveBlocks(blocksInput) {
    const blocks = blocksInput.map(block => {
        block.transactions = block.transactions.map((tx, index) => {
            tx.operations = tx.operations.map(op => {
                const typeS = op.type.split('_')
                const typeB = typeS.splice(0, typeS.length - 1).join('_');
                if (typeB === 'transfer') {
                    let unit;
                    if (op.value.amount.nai === '@@000000021') {
                        unit = 'HIVE'
                    } else if (op.value.amount.nai === '@@000000013') {
                        unit = 'HBD'
                    }
                    op.value.amount = `${Number(op.value.amount.amount) / Math.pow(10, op.value.amount.precision)} ${unit}`;
                }
                return [typeS.splice(0, typeS.length - 1).join('_'), op.value]
            })
            tx.transaction_id = block.transaction_ids[index]
            tx.block_num = parseInt(block.block_id.slice(0, 8), 16)
            tx.timestamp = block.timestamp
            return tx;
        })
        return block
    })
    return blocks
}

export async function* liveHiveBlocks(API, opts: {
    start_block: number,
    signal: AbortSignal
}) {


    let last_block = opts.start_block
    let count = 0;
    let bh = 0;
    const headUpdater = setInterval(async () => {
        const hive = new Client(HIVE_API)
        bh = await hive.blockchain.getCurrentBlockNum()
        const dynProps = await hive.database.getDynamicGlobalProperties()
        // console.log({
        //   last_irreversible_block_num: dynProps.last_irreversible_block_num,
        //   head_block_number: dynProps.head_block_number
        // })
        // console.log(bh, last_block,)
        count = bh - last_block
        // console.log('count', count)
    }, 500)

    opts.signal.addEventListener('abort', () => {
        clearInterval(headUpdater)
    })


    for (; ;) {
        if (count < 1) {
            await sleep(50)
            continue;
        }

        if (opts.signal.aborted) {
            return []
        }

        if (bh > last_block + 1) {
            try {
                const { data } = await Axios.post(API, {
                    "jsonrpc": "2.0",
                    "method": "block_api.get_block_range",
                    "params": {
                        "starting_block_num": last_block,
                        "count": count > 100 ? 100 : count
                    },
                    "id": 1
                })

                for (let block of parseHiveBlocks(data.result.blocks)) {
                    console.log('281', last_block, parseInt(block.block_id.slice(0, 8), 16), bh)

                    last_block = parseInt(block.block_id.slice(0, 8), 16)
                    count = bh - last_block
                    // console.log(new Date().getTime() - new Date(block.timestamp + "Z").getTime())


                    // console.log(block.timestamp, new Date().toISOString(), new Date().getTime() - new Date(block.timestamp + "Z").getTime(), new Date().getTime() - requestTime.getTime())
                    yield block
                }

            } catch (ex) {
                console.log(ex)
                await sleep(5_000)
            }
        }
        if (bh === last_block + 1) {
            try {
                const lstBlock = await HiveClient.database.getBlock(bh)
                if (lstBlock) {
                    last_block = parseInt(lstBlock.block_id.slice(0, 8), 16)
                    // console.log(lstBlock)
                    // console.log(new Date().getTime() - new Date(lstBlock.timestamp + "Z").getTime())
                    yield lstBlock
                } else {
                    await sleep(500)
                }
            } catch (ex) {
                await sleep(5_000)
            }
        }
        await sleep(1)
    }
}

export async function streamHiveBlocks(API, opts) {
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const { data } = await Axios.post(API, {
                "jsonrpc": "2.0",
                "method": "block_api.get_block_range",
                "params": {
                    "starting_block_num": opts.start_block,
                    "count": opts.count
                },
                "id": 1
            })

            if (!data.result) {
                console.log(data)
            }
            return parseHiveBlocks(data.result.blocks)
        } catch (ex) {
            console.log(ex)
            if (attempt === 0) {
                await sleep(5_000)
            } else {
                await sleep(20_000 * attempt)
            }
            continue;
        }

    }
    throw new Error('Block stream failed after 5 requests')
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }