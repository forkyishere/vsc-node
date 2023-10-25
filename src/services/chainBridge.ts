import 'dotenv/config'
import moment from 'moment'
import { CoreService } from '.'
import { ChainParserEvents } from '../../chainstate-lib/ChainStateLib'
import networks from './networks'
import { WitnessService } from './witness'
import { Deposit, WithdrawLock } from '../../chainstate-lib/types/balanceData'
import { WithdrawFinalization, CoreTransactionTypes } from '../../chainstate-lib/types/coreTransactions'

// pla: coordinates actions that require communication inbetween the 2 chains
// e.g.: sending a withdraw finalization hive transaction triggered via a vsc transaction 
export class ChainBridge {
  self: CoreService
  witness: WitnessService
  multiSigWithdrawBuffer: Array<Deposit>

  constructor(self: CoreService) {
    this.self = self
  }

  // pla: the multisig consensus has been reached and a selected node now transfers the funds
  // move to transactionpoolservice?
  async finalizeBalanceUpdate(depositId: string) {
    const memo: WithdrawFinalization = {
      net_id: this.self.config.get('network.id'),
      deposit_id: depositId,
      action: CoreTransactionTypes.withdraw_finalization
    } as WithdrawFinalization

    //TransactionPoolService.createCoreTransferTransaction... (amount = depositId.active_balance)
  }

  async processBalanceUpdate(block_height: number) {
    for (let i = this.multiSigWithdrawBuffer.length - 1; i >= 0; i--) {
      const withdraw = this.multiSigWithdrawBuffer[i];
      // ensure that there is a safe distance between the receival of the withdraw request and the current block
      const SAFE_BLOCK_DISTANCE = 5
      if (withdraw.create_block.included_block + SAFE_BLOCK_DISTANCE < block_height) {
        const multisigBalanceController = withdraw.controllers.find(c => c.authority === networks[this.self.config.get('network.id')].multisigAccount)

        if (multisigBalanceController) {
          const withdrawLock = <WithdrawLock>multisigBalanceController.conditions.find(c => c.type === 'WITHDRAW')

          if (withdrawLock && withdrawLock.expiration_block > block_height) {
            this.self.logger.info(`withdraw request for deposit ${withdraw.id} has been finalized`)
            // sign the balance update and publish via p2p multisig
            // maybe do some more checks/ verifications to ensure that everything is working as intended
          }
        }

        // when we get to this point, something has gone wrong OR we successfully signed and proposed the withdraw
        // in an error case either the request is expired, something is wrong with the data and so on
        // we remove the withdraw request from the buffer
        this.multiSigWithdrawBuffer.splice(i, 1);
      }
    }
  }

  async start() {
    this.multiSigWithdrawBuffer = []
    const parserHive = this.self.chainStateLib.chainParserHIVE
    this.self.chainStateLib.events.on(ChainParserEvents.StreamCheck, () => {
      (async () => {
        if (parserHive.hiveStream.blockLag > 300 && typeof parserHive.hiveStream.blockLag === 'number') {
          await this.self.nodeInfo.setStatus({
            id: "out_of_sync",
            action: "disable_witness",
            expires: moment().add('1', 'day').toDate()
          })
        }
      })();
    })

    this.self.chainStateLib.events.on(ChainParserEvents.StreamSynced, () => {
      (async () => {
        await this.self.nodeInfo.nodeStatus.deleteMany({
          id: "out_of_sync",
        })
      })();
    })

    this.self.chainStateLib.events.on(ChainParserEvents.StreamOutOfSync, () => {
      (async () => {
        await this.self.nodeInfo.setStatus({
          id: "out_of_sync",
          action: "disable_witness",
          expires: moment().add('1', 'day').toDate()
        })
      })();
    })

    this.self.chainStateLib.events.on(ChainParserEvents.HiveBlock, (block_height, block) => {
      this.processBalanceUpdate(block_height);
    })

    this.self.chainStateLib.events.on(ChainParserEvents.VerifiedWithdrawRequest, (deposit) => {
      this.multiSigWithdrawBuffer.push(deposit);
    })

    this.witness = new WitnessService(this.self)
  }
}
