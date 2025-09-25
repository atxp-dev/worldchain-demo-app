"use client";

import { WorldchainAccount } from "@atxp/worldchain";
import { atxpClient } from "@atxp/client";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
// import ky from "ky";
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { parseUnits, Transaction } from "viem";
import { useAccount, useConnectorClient } from "wagmi";
import { useSession } from "next-auth/react";
import {
  GeneratedResult,
} from "@/types/ai.type";
import { ConsoleLogger, LogLevel } from "@atxp/common";
import { MiniKit, SendTransactionInput } from "@worldcoin/minikit-js";

interface AtxpContextType {
  atxpAccount: WorldchainAccount | null;
  clearAtxp: () => void;
  generateImage: (args: {
    prompt: string;
    messageId: string;
  }) => Promise<GeneratedResult>;
  waitForImage: (args: { taskId: string }) => Promise<string | null>;
}

const AtxpContext = createContext<AtxpContextType | undefined>(undefined);

export const IMAGE_SERVICE = {
  mcpServer: "https://image.mcp.atxp.ai/",
  createImageToolName: "image_create_image",
  createImageAsyncToolName: "image_create_image_async",
  getImageAsyncToolName: "image_get_image_async",
  description: "ATXP Image MCP server",
  getArguments: (prompt: string) => ({ prompt }),
  getWaitForImageArguments: (taskId: string) => ({
    taskId,
    timeoutSeconds: 300,
  }),
  getResult: (result: {content: [{text: string}]}) => {
    console.log("image result", JSON.stringify(result, null, 2));
    // Handle different result formats based on service
    if (
      result.content &&
      Array.isArray(result.content) &&
      result.content[0]?.text
    ) {
      try {
        const parsedResult = JSON.parse(result.content[0].text);
        return parsedResult.url;
      } catch {
        return JSON.parse(result.content[0].text);
      }
    } else {
      return result.content[0].text;
    }
  },
  getAsyncCreateResult: (result: {content: [{text: string}]}) => {
    console.log("image create result", JSON.stringify(result, null, 2));
    const jsonResult = result.content[0].text;
    const parsed = JSON.parse(jsonResult);
    return { taskId: parsed.taskId };
  },
  getAsyncStatusResult: (result: {content: [{text: string}]}) => {
    console.log("image status result", JSON.stringify(result, null, 2));
    return JSON.parse(result.content[0].text);
  },
};

export const useAtxp = () => {
  const context = useContext(AtxpContext);
  if (!context) {
    throw new Error(
      "useEnvironment must be used within an EnvironmentProvider",
    );
  }
  return context;
};

interface AtxpProviderProps {
  children: ReactNode;
}


export const AtxpProvider = ({ children }: AtxpProviderProps) => {
  const [atxpAccount, setAtxpAccount] = useState<WorldchainAccount | null>(null);
  const [atxpImageClient, setAtxpImageClient] = useState<Client | null>(null);

  const { address } = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const { data: session } = useSession();

  const loadAtxp = useCallback(async () => {
    // Try to get wallet address from wagmi first, then from session
    const walletAddress = address || session?.user?.walletAddress;

    if (!walletAddress) {
      return null;
    }

    // If no connector client from wagmi, create a simple MiniKit provider
    let provider:unknown;
    if (connectorClient) {
      provider = {
        ...connectorClient,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        request: async (args: any) => {
          console.log("[connectorClient] request:", args);
          return connectorClient.request(args);
        },
      };
    } else {
      // Create a minimal MiniKit-compatible provider
      console.log("Using MiniKit provider for ATXP account");
      provider = {
        request: async (args: { method: string; params: unknown[] }) => {
          const { method, params } = args;
          console.log("[miniKitConnectorClient] request:", args);
          if (method === 'eth_sendTransaction') {
            console.log("[miniKitConnectorClient] Contract address:", params[0]?.to);
            console.log("[miniKitConnectorClient] Expected USDC mainnet:", "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1");
            console.log("[miniKitConnectorClient] Expected USDC sepolia:", "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88");
          }
          switch (method) {
            case 'eth_accounts':
              return [walletAddress];
            case 'eth_chainId':
              return '0x1e0'; // Worldchain chain ID (480)
            case 'eth_requestAccounts':
              return [walletAddress];
            case 'eth_sendTransaction':
              const transaction = params[0] as {data: string, to: string, value?: string, from: string};

              // Handle USDC transfer (ERC20 transfer function)
              if (transaction.data && transaction.data.startsWith('0xa9059cbb')) {
                // This is a transfer(address,uint256) call - decode the parameters
                const data = transaction.data.slice(10); // Remove function selector

                // Extract recipient address (first 32 bytes, last 20 bytes are the address)
                const recipientHex = '0x' + data.slice(24, 64);

                // Extract amount (next 32 bytes)
                const amountHex = '0x' + data.slice(64, 128);
                const amount = BigInt(amountHex).toString();

                // Validate transaction parameters
                console.log("[MiniKit] Decoded transaction parameters:", {
                  contractAddress: transaction.to,
                  recipient: recipientHex,
                  amount: amount,
                  amountInUSDC: (Number(amount) / 1000000).toString() + ' USDC',
                  from: transaction.from
                });

                // Check for memo data (any data after the standard 128 characters)
                let memo = '';
                if (data.length > 128) {
                  const memoHex = data.slice(128);
                  try {
                    memo = Buffer.from(memoHex, 'hex').toString('utf8');
                    console.log(`[MiniKit] Extracted memo from transaction: "${memo}"`);
                  } catch (e) {
                    console.warn('[MiniKit] Failed to decode memo data:', e);
                  }
                }

                // ERC20 ABI for transfer function
                const ERC20_ABI = [
                  {
                    inputs: [
                      { name: 'to', type: 'address' },
                      { name: 'amount', type: 'uint256' }
                    ],
                    name: 'transfer',
                    outputs: [{ name: '', type: 'bool' }],
                    stateMutability: 'nonpayable',
                    type: 'function'
                  }
                ] as const;

                const input: SendTransactionInput = {
                  transaction: [
                    {
                      address: transaction.to, // USDC contract address
                      abi: ERC20_ABI,
                      functionName: 'transfer',
                      args: [recipientHex, amount],
                      value: transaction.value || "0"
                    }
                  ]
                };

                // Note: MiniKit doesn't have a standard way to include memo data in ERC20 transfers
                // The memo is extracted and logged but not included in the transaction
                if (memo) {
                  console.log(`[MiniKit] Memo "${memo}" will be lost in MiniKit transaction - consider alternative approach`);
                }

                console.log("[MiniKit] Sending transaction with input:", JSON.stringify(input, null, 2));
                const sentResult = await MiniKit.commandsAsync.sendTransaction(input);

                console.log("[MiniKit] Transaction result:", JSON.stringify(sentResult, null, 2));

                if (sentResult.finalPayload?.status === 'success') {
                  return sentResult.finalPayload.transaction_id;
                }

                // Enhanced error logging for debugging
                const errorCode = sentResult.finalPayload?.error_code;
                const debugUrl = sentResult.finalPayload?.debug_url;
                const errorMessage = sentResult.finalPayload?.error_message;
                const simulationError = sentResult.finalPayload?.details?.simulationError;

                console.error("[MiniKit] Transaction failed:", {
                  errorCode,
                  errorMessage,
                  simulationError,
                  debugUrl,
                  fullPayload: sentResult.finalPayload
                });

                if (debugUrl) {
                  console.error("[MiniKit] Debug URL for simulation failure:", debugUrl);
                }

                // Provide more user-friendly error messages
                let userFriendlyError = `MiniKit sendTransaction failed: ${errorCode}`;

                if (simulationError?.includes('transfer amount exceeds balance')) {
                  const amountUSDC = (Number(amount) / 1000000).toFixed(6);
                  userFriendlyError = `💳 Insufficient USDC Balance\n\n` +
                    `You're trying to send ${amountUSDC} USDC, but your wallet doesn't have enough funds.\n\n` +
                    `To complete this payment:\n` +
                    `• Add USDC to your World App wallet\n` +
                    `• Bridge USDC from another chain\n` +
                    `• Buy USDC directly in World App\n\n` +
                    `Wallet: ${transaction.from?.slice(0, 6)}...${transaction.from?.slice(-4)}`;
                } else if (simulationError) {
                  userFriendlyError += ` - ${simulationError}`;
                } else if (errorMessage) {
                  userFriendlyError += ` - ${errorMessage}`;
                }

                if (debugUrl) {
                  userFriendlyError += ` (Debug: ${debugUrl})`;
                }

                throw new Error(userFriendlyError);
              }

              // Handle simple ETH transfers (no data or empty data)
              if (!transaction.data || transaction.data === '0x') {
                // For ETH transfers, you'd need to use the Forward contract
                throw new Error('ETH transfers require Forward contract - not implemented yet');
              }

              // For other transaction types
              throw new Error(`Unsupported transaction type. Data: ${transaction.data.slice(0, 10)}`);

            case 'personal_sign':
              const [message] = params;
              const signResult = await MiniKit.commandsAsync.signMessage({ message });
              if (signResult?.finalPayload?.status === 'success') {
                return signResult.finalPayload.signature;
              }
              throw new Error(`MiniKit signing failed: ${signResult?.finalPayload?.error_code}`);
            default:
              throw new Error(`Method ${method} not supported in MiniKit context`);
          }
        },
      };
    }

    const tmpAtxpAccount = await WorldchainAccount.initialize({
      walletAddress,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: provider as any, // Type cast needed for client compatibility
      allowance: parseUnits("10", 6), // 10 USDC
      useEphemeralWallet: false, // Regular wallet mode (smart wallet infrastructure not available on World Chain)
      periodInDays: 30,
    });

    setAtxpAccount(tmpAtxpAccount);
    return tmpAtxpAccount;
  }, [address, connectorClient, session?.user?.walletAddress]);

  // Auto-initialize ATXP account when we get an address (wagmi or session)
  useEffect(() => {
    const walletAddress = address || session?.user?.walletAddress;

    if (walletAddress && !atxpAccount) {
      console.log("Triggering ATXP account initialization - walletAddress:", walletAddress);
      loadAtxp();
    }
  }, [address, connectorClient, session?.user?.walletAddress, atxpAccount, loadAtxp]);

  const clearAtxp = useCallback(() => {
    if (!address) return;
    WorldchainAccount.clearAllStoredData(address);
    setAtxpAccount(null);
  }, [address]);

  const generateImage = useCallback(
    async ({
      prompt,
    }: {
      prompt: string;
    }): Promise<GeneratedResult> => {
      if (!prompt)
        return {
          isError: true,
          error: "Prompt is required",
        };
      let tmpAtxpAccount = atxpAccount;
      if (!tmpAtxpAccount) {
        tmpAtxpAccount = await loadAtxp();
      }
      if (!tmpAtxpAccount) {
        console.error("Failed to load ATXP account");
        return {
          isError: true,
          error: "Failed to load ATXP account",
        };
      }

      let imageClient = atxpImageClient;
      if (!imageClient) {
        // Try to generate a JWT manually before client creation for debugging
        imageClient = await atxpClient({
          account: tmpAtxpAccount,
          mcpServer: IMAGE_SERVICE.mcpServer,
          logger: new ConsoleLogger({ level: LogLevel.DEBUG }),
          onPayment: async ({ payment }) => {
            console.log("🎉 ATXP Payment callback triggered:", payment);
          },
          onPaymentFailure: async ({ payment, error }) => {
            console.log("❌ ATXP Payment failure callback triggered:", payment, error);
          }
        });

        console.log("🎯 ATXP client created successfully");
        setAtxpImageClient(imageClient);
      }

      console.log("🛠️ Making authenticated API call to ATXP backend...");
      const response = await imageClient.callTool({
        name: IMAGE_SERVICE.createImageAsyncToolName,
        arguments: IMAGE_SERVICE.getArguments(prompt),
      });

      console.log("📨 Backend response received:", {
        success: !!response,
        responseType: typeof response,
        note: "If this works, JWT verification succeeded on backend"
      });

      console.log("image gen async response", response);

      const finalResult = IMAGE_SERVICE.getAsyncCreateResult(response as {content: [{text: string}]});
      console.log("image gen final result", finalResult);

      return {
        isError: false,
        taskId: finalResult.taskId,
      };
    },
    [atxpAccount, atxpImageClient, loadAtxp],
  );


  const waitForImage = useCallback(
    async ({ taskId }: { taskId: string }) => {
      if (!taskId) return;
      let tmpAtxpAccount = atxpAccount;
      if (!tmpAtxpAccount) {
        tmpAtxpAccount = await loadAtxp();
      }
      if (!tmpAtxpAccount) {
        console.error("Failed to load ATXP account");
        return;
      }

      let imageClient = atxpImageClient;
      if (!imageClient) {
        console.log("🔐 Creating ATXP client for image status polling JWT transmission...");

        imageClient = await atxpClient({
          account: tmpAtxpAccount,
          mcpServer: IMAGE_SERVICE.mcpServer,
        });
        setAtxpImageClient(imageClient);

        console.log("🎯 ATXP client for polling created successfully");
      }

      console.log("🛠️ Making authenticated status polling API call...");
      const response = await imageClient.callTool({
        name: IMAGE_SERVICE.getImageAsyncToolName,
        arguments: IMAGE_SERVICE.getWaitForImageArguments(taskId),
      });
      console.log("image wait for response", response);
      const finalResult = IMAGE_SERVICE.getAsyncStatusResult(response as {content: [{text: string}]});
      console.log("image wait for final result", finalResult);

      if (
        finalResult.status === "completed" ||
        finalResult.status === "success"
      ) {
        return finalResult.url;
      } else {
        return null;  // TODO: handle error
      }
    },
    [atxpAccount, atxpImageClient, loadAtxp],
  );


  return (
    <AtxpContext.Provider
      value={{
        atxpAccount,
        clearAtxp,
        generateImage,
        waitForImage,
      }}>
      {children}
    </AtxpContext.Provider>
  );
};
