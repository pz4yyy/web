import { ENTRYPOINT_ADDRESS_V06, UserOperation } from "permissionless";
import {
  Address,
  BlockTag,
  Hex,
  decodeAbiParameters,
  decodeFunctionData,
} from "viem";
import { baseSepolia } from "viem/chains";
import {initializeClient} from "../../src/utils/paymasterConfig";


import {
  coinbaseSmartWalletABI,
  CB_SW_FACTORY_ADDRESS,
  CB_SW_PROXY_BYTECODE,
  CB_SW_V1_IMPLEMENTATION_ADDRESS,
  ERC_1967_PROXY_IMPLEMENTATION_SLOT,
  magicSpendAddress
} from "../constants"
import RegistrarControllerABI from 'apps/web/src/abis/RegistrarControllerABI.json';
import { USERNAME_REGISTRAR_CONTROLLER_ADDRESS } from 'apps/web/src/addresses/usernames';

export async function willSponsor({
    chainId,
    entrypoint,
    userOp,
}: {chainId: number; entrypoint: string; userOp: UserOperation<"v0.6">}) {
    if (chainId != baseSepolia.id) return false;
    if (entrypoint.toLowerCase() !== ENTRYPOINT_ADDRESS_V06.toLowerCase()) return false;

    try {
        const publicClient = initializeClient();
        const code = await publicClient.getCode({ address: userOp.sender });
     
        if (!code) {
          // no code at address, check that the initCode is deploying a Coinbase Smart Wallet
          // factory address is first 20 bytes of initCode after '0x'
          const factoryAddress = userOp.initCode.slice(0, 42);
          if (factoryAddress.toLowerCase() !== CB_SW_FACTORY_ADDRESS.toLowerCase())
            return false;
        } else {
          // code at address, check that it is a proxy to the expected implementation
          if (code != CB_SW_PROXY_BYTECODE) return false;
     
          // check that userOp.sender proxies to expected implementation
          const implementation = await publicClient.request<{
            Parameters: [Address, Hex, BlockTag];
            ReturnType: Hex;
          }>({
            method: "eth_getStorageAt",
            params: [userOp.sender, ERC_1967_PROXY_IMPLEMENTATION_SLOT, "latest"],
          });
          const implementationAddress = decodeAbiParameters(
            [{ type: "address" }],
            implementation
          )[0];
          if (implementationAddress != CB_SW_V1_IMPLEMENTATION_ADDRESS)
            return false;
        }

        const calldata = decodeFunctionData({
            abi: coinbaseSmartWalletABI,
            data: userOp.callData,
          });
        // keys.coinbase.com always uses executeBatch
    if (calldata.functionName !== "executeBatch") return false;
    if (!calldata.args || calldata.args.length == 0) return false;
 
    const calls = calldata.args[0] as {
      target: Address;
      value: bigint;
      data: Hex;
    }[];
    // modify if want to allow batch calls to your contract
    if (calls.length > 2) return false;
 
    let callToCheckIndex = 0;
    if (calls.length > 1) {
      // if there is more than one call, check if the first is a magic spend call
      if (calls[0].target.toLowerCase() !== magicSpendAddress.toLowerCase())
        return false;
      callToCheckIndex = 1;
    }
 
    if (
      calls[callToCheckIndex].target.toLowerCase() !==
      USERNAME_REGISTRAR_CONTROLLER_ADDRESS[chainId].toLowerCase() 
    )
      return false;
 
    const innerCalldata = decodeFunctionData({
      abi: RegistrarControllerABI,
      data: calls[callToCheckIndex].data,
    });
    if (innerCalldata.functionName !== "register") return false;
 
    return true;
  } catch (e) {
    console.error(`willSponsor check failed: ${e}`);
    return false;
  }
}

