import { ethers } from 'ethers';
import * as landSalesAbi from './abi/landSales';

export const isMoonbaseAlpha = false;

export const contractOld = isMoonbaseAlpha
  ? '0x17F7718b7748D89dd98540B50ef049af1a9b99C5'.toLowerCase()
  : '0x98af019cdf16990130cba555861046b02e9898cc'.toLowerCase();
export const contractNew = isMoonbaseAlpha
  ? '0x42B7f13F309a5bf55dC4f358561cBcC8aCdb0164'.toLowerCase()
  : '0x913a3e067a559ba24a7a06a6cdea4837eeeaf72d'.toLowerCase();
export const contractXcRMRK = isMoonbaseAlpha
  ? '0x3Ff3B0361B450E70729006918c14DEb6Da410349'.toLowerCase()
  : '0xffffffff893264794d9d57e1e0e21e0042af5a0a'.toLowerCase();

export const CHAIN_NODE = isMoonbaseAlpha
  ? 'wss://wss.api.moonbase.moonbeam.network'
  : 'wss://wss.api.moonriver.moonbeam.network';

export const contract = new ethers.Contract(
  contractNew,
  landSalesAbi.abi,
  new ethers.providers.WebSocketProvider(CHAIN_NODE),
);
