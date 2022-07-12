import { ethers } from "ethers";
import * as landSalesAbi from "./abi/landSales";

export const CHAIN_NODE = "wss://wss.api.moonriver.moonbeam.network";

export const contract = new ethers.Contract(
    "0x98af019cdf16990130cba555861046b02e9898cc",
    landSalesAbi.abi,
    new ethers.providers.WebSocketProvider(CHAIN_NODE)
);
