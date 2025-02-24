import {
  addressToScript,
  blake160,
  hexToBytes,
  serializeScript,
  serializeWitnessArgs,
} from '@nervosnetwork/ckb-sdk-utils'
import {
  FEE,
  MIN_CAPACITY,
  getJoyIDCellDep,
  getInscriptionInfoTypeScript,
  getInscriptionInfoDep,
  getCotaTypeScript,
} from '../constants'
import { Address, SubkeyUnlockReq } from '../types'
import {
  DeployParams,
  DeployResult,
  DeployXinsResult,
  InscriptionInfo,
  InscriptionXinsInfo,
} from '../types/inscription'
import {
  calcInscriptionInfoSize,
  calcXinsHash,
  calcXudtHash,
  calculateTransactionFee,
  generateInscriptionId,
  serializeInscriptionInfo,
  serializeInscriptionXinsInfo,
} from './helper'
import { append0x } from '../utils'
import { CapacityNotEnoughException, NoCotaCellException, NoLiveCellException } from '../exceptions'

// include lock, inscription info type, capacity and 60000 shannon for tx fee
export const calcInscriptionInfoCapacity = (address: Address, info: InscriptionInfo) => {
  const lock = addressToScript(address)
  const argsSize = hexToBytes(lock.args).length
  const lockSize = 32 + 1 + argsSize
  const inscriptionInfoTypeSize = 32 + 32 + 1
  const capacitySize = 8
  const xudtDataSize = calcInscriptionInfoSize(info)
  const cellSize = lockSize + inscriptionInfoTypeSize + capacitySize + xudtDataSize
  return BigInt(cellSize) * BigInt(10000_0000) + BigInt(6_0000)
}

export const buildDeployTx = async ({
  collector,
  joyID,
  address,
  info,
  feeRate,
}: DeployParams): Promise<DeployResult> => {
  const isMainnet = address.startsWith('ckb')
  const txFee = feeRate ? calculateTransactionFee(feeRate) : FEE
  const lock = addressToScript(address)
  const cells = await collector.getCells({ lock })
  if (!cells || cells.length === 0) {
    throw new NoLiveCellException('The address has no live cells')
  }

  const infoCapacity = calcInscriptionInfoCapacity(address, info)
  const { inputs, capacity: inputCapacity } = collector.collectInputs(cells, infoCapacity, txFee)

  const inscriptionId = generateInscriptionId(inputs[0], 0)

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: inscriptionId,
  }

  let outputs: CKBComponents.CellOutput[] = [
    {
      capacity: `0x${infoCapacity.toString(16)}`,
      lock,
      type: inscriptionInfoType,
    },
  ]
  const changeCapacity = inputCapacity - txFee - infoCapacity
  if (changeCapacity < MIN_CAPACITY) {
    throw new CapacityNotEnoughException('Not enough capacity for change cell')
  }
  outputs.push({
    capacity: `0x${changeCapacity.toString(16)}`,
    lock,
  })

  let cellDeps = [getJoyIDCellDep(isMainnet), getInscriptionInfoDep(isMainnet)]

  const newInfo: InscriptionInfo = {
    ...info,
    xudtHash: calcXudtHash(inscriptionInfoType, isMainnet),
  }
  const inscriptionInfo = append0x(serializeInscriptionInfo(newInfo))

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [serializeWitnessArgs(emptyWitness), '0x']
  if (joyID && joyID.connectData.keyType === 'sub_key') {
    const pubkeyHash = append0x(blake160(append0x(joyID.connectData.pubkey), 'hex'))
    const req: SubkeyUnlockReq = {
      lockScript: serializeScript(lock),
      pubkeyHash,
      algIndex: 1, // secp256r1
    }
    const { unlockEntry } = await joyID.aggregator.generateSubkeyUnlockSmt(req)
    const emptyWitness = {
      lock: '',
      inputType: '',
      outputType: append0x(unlockEntry),
    }
    witnesses[0] = serializeWitnessArgs(emptyWitness)

    const cotaType = getCotaTypeScript(isMainnet)
    const cotaCells = await collector.getCells({ lock, type: cotaType })
    if (!cotaCells || cotaCells.length === 0) {
      throw new NoCotaCellException("Cota cell doesn't exist")
    }
    const cotaCell = cotaCells[0]
    const cotaCellDep: CKBComponents.CellDep = {
      outPoint: cotaCell.outPoint,
      depType: 'code',
    }
    cellDeps = [cotaCellDep, ...cellDeps]
  }
  const rawTx: CKBComponents.RawTransaction = {
    version: '0x0',
    cellDeps,
    headerDeps: [],
    inputs,
    outputs,
    outputsData: [inscriptionInfo, '0x'],
    witnesses,
  }

  return { rawTx, inscriptionId, xudtHash: newInfo.xudtHash }
}

export const buildDeployXinsTx = async ({
  collector,
  joyID,
  address,
  info,
  feeRate,
}: DeployParams): Promise<DeployXinsResult> => {
  const isMainnet = address.startsWith('ckb')
  const txFee = feeRate ? calculateTransactionFee(feeRate) : FEE
  const lock = addressToScript(address)
  const cells = await collector.getCells({ lock })
  if (!cells || cells.length === 0) {
    throw new NoLiveCellException('The address has no live cells')
  }

  const infoCapacity = calcInscriptionInfoCapacity(address, info)
  const { inputs, capacity: inputCapacity } = collector.collectInputs(cells, infoCapacity, txFee)

  const inscriptionId = generateInscriptionId(inputs[0], 0)

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: inscriptionId,
  }

  let outputs: CKBComponents.CellOutput[] = [
    {
      capacity: `0x${infoCapacity.toString(16)}`,
      lock,
      type: inscriptionInfoType,
    },
  ]
  const changeCapacity = inputCapacity - txFee - infoCapacity
  if (changeCapacity < MIN_CAPACITY) {
    throw new CapacityNotEnoughException('Not enough capacity for change cell')
  }
  outputs.push({
    capacity: `0x${changeCapacity.toString(16)}`,
    lock,
  })

  let cellDeps = [getJoyIDCellDep(isMainnet), getInscriptionInfoDep(isMainnet)]

  const newInfo: InscriptionXinsInfo = {
    ...info,
    xinsHash: calcXinsHash(inscriptionInfoType, isMainnet),
  }
  const inscriptionInfo = append0x(serializeInscriptionXinsInfo(newInfo))

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [serializeWitnessArgs(emptyWitness), '0x']
  if (joyID && joyID.connectData.keyType === 'sub_key') {
    const pubkeyHash = append0x(blake160(append0x(joyID.connectData.pubkey), 'hex'))
    const req: SubkeyUnlockReq = {
      lockScript: serializeScript(lock),
      pubkeyHash,
      algIndex: 1, // secp256r1
    }
    const { unlockEntry } = await joyID.aggregator.generateSubkeyUnlockSmt(req)
    const emptyWitness = {
      lock: '',
      inputType: '',
      outputType: append0x(unlockEntry),
    }
    witnesses[0] = serializeWitnessArgs(emptyWitness)

    const cotaType = getCotaTypeScript(isMainnet)
    const cotaCells = await collector.getCells({ lock, type: cotaType })
    if (!cotaCells || cotaCells.length === 0) {
      throw new NoCotaCellException("Cota cell doesn't exist")
    }
    const cotaCell = cotaCells[0]
    const cotaCellDep: CKBComponents.CellDep = {
      outPoint: cotaCell.outPoint,
      depType: 'code',
    }
    cellDeps = [cotaCellDep, ...cellDeps]
  }
  const rawTx: CKBComponents.RawTransaction = {
    version: '0x0',
    cellDeps,
    headerDeps: [],
    inputs,
    outputs,
    outputsData: [inscriptionInfo, '0x'],
    witnesses,
  }

  return { rawTx, inscriptionId, xinsHash: newInfo.xinsHash }
}
