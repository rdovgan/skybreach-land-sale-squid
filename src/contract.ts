import { ethers } from "ethers";
import * as landSalesAbi from "./abi/landSales";

export const CHAIN_NODE = "wss://wss.api.moonriver.moonbeam.network";

export const contract = new ethers.Contract(
    "0x913a3e067a559ba24a7a06a6cdea4837eeeaf72d",
    landSalesAbi.abi,
    new ethers.providers.WebSocketProvider(CHAIN_NODE)
);
