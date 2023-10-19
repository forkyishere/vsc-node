import { Collection } from "mongodb";
import { ChainStateLib } from "./ChainStateLib";
import { Deposit, DepositDrain } from "./types/balanceData";
import { BlockRef } from "./types/blockData";

// houses deposit related methods, used by the HIVE *AND* the VSC chain parser
export class DepositHelper {
  balanceDb: Collection<Deposit>;

  constructor(balanceDb: Collection<Deposit>) {
    this.balanceDb = balanceDb;
  }

  // used when a withdraw/ transfer has taken place and the outputs of the deposits are updated with their reference deposits that received the balance
  async updateSourceDeposits(depositDrains: Array<DepositDrain>, targetDepositId: string) {
    for (let depositDrain of depositDrains) {
      const outputDepositDrain = {
        deposit_id: targetDepositId,
        amount: depositDrain.amount
      } as DepositDrain

      await this.balanceDb.updateOne({ id: depositDrain.deposit_id }, 
        { 
          $inc: {
            active_balance: depositDrain.amount * -1
          },
          $push: { 
            outputs: outputDepositDrain
          },
          $set: {
            last_interacted_at: new Date()
          }
        }
      )
    }
  }

  determineDepositDrains(deposits: Array<Deposit>, amount: number): { isEnoughBalance: boolean, deposits: Array<DepositDrain> } {
    let missingAmount = amount;
    const choosenDeposits = [];

    for (let deposit of deposits) {
      if (deposit.active_balance !== 0) {
        let drainedBalance: number;
        if (missingAmount > deposit.active_balance) {
          drainedBalance = deposit.active_balance;
        } else {
          drainedBalance = missingAmount; 
        }
        missingAmount -= drainedBalance;
        choosenDeposits.push({ deposit_id: deposit.id, amount: drainedBalance });        
        
        if (missingAmount == 0) {
          break;
        }
      }
    }

    // pla: TODO probably still has rounding issues
    return { isEnoughBalance: missingAmount === 0, deposits: choosenDeposits };
  }

  
  // pla: in here verify the controller conditions, if not met the deposit cannot be drained at this point
  getDepositsWithMetConditions(deposits: Array<Deposit>, currentBlock: BlockRef, hashSolvers?: Array<string>): Array<Deposit> {
    // ... if found condition hashlock ... verify if supplied secret is correct
    // ... if found timelock, verify against current block
    
    // return deposits here but sort by active_balance
    return deposits.sort((a, b) => {
      if (a.active_balance < b.active_balance) {
          return -1;
      }
      if (a.active_balance > b.active_balance) {
          return 1;
      }
      return 0;
    });
  }

  // pla: TODO, filter for the asset type, a user might only withdraw/ transfer a specific asset in one tx
  async getUserControlledBalances(accountId: string, contractId?: string): Promise<Array<Deposit>> {
    
    const userOwnedBalancesQuery = {
      'controllers': {
          $elemMatch: {
              'type': { $in: ['HIVE', 'DID'] }, // maybe its needed to convert the hive account into did as well as the deposit from the user might not be his hive acc id, so some deposits would slip through
              'authority': accountId
          }
      }
    };

    if (contractId) {
      userOwnedBalancesQuery['controllers']['$elemMatch']['contract_id'] = contractId;
    }

    return await this.balanceDb.find(userOwnedBalancesQuery).toArray();
  }

  // get the users total balance for general deposits or for a specific contract
  async calculateBalanceSum(accountId: string, currentBlock: BlockRef, contractId?: string, hashSolvers?: Array<string>) {
    let balance = 0

    let deposits = await this.getUserControlledBalances(accountId, contractId); 

    deposits = this.getDepositsWithMetConditions(deposits, currentBlock, hashSolvers);

    for (let deposit of deposits) {
      balance += deposit.active_balance;
    }

    return balance;
  }

  public static parseFormattedAmount(formattedAmount): {amount: number, assetSymbol: string} {
    const [amountStr, assetSymbol] = formattedAmount.split(' ');
    const amount = parseFloat(amountStr);
  
    return { amount, assetSymbol };
  }
}