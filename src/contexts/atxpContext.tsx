"use client";

import { WorldAppAccount } from "@atxp/worldcoin";
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
import { parseUnits } from "viem";
import { useAccount, useConnectorClient } from "wagmi";
import { useSession } from "next-auth/react";
import { MiniKit } from "@worldcoin/minikit-js";
import {
  GeneratedResult,
} from "@/types/ai.type";

interface AtxpContextType {
  atxpAccount: WorldAppAccount | null;
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
  const [atxpAccount, setAtxpAccount] = useState<WorldAppAccount | null>(null);
  const [atxpImageClient, setAtxpImageClient] = useState<Client | null>(null);

  const { address } = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const { data: session } = useSession();

  const loadAtxp = useCallback(async () => {
    // Try to get wallet address from wagmi first, then from session
    const walletAddress = address || session?.user?.walletAddress;

    console.log("🏗️ ATXP ACCOUNT LOADING DEBUG:", {
      wagmiAddress: address,
      sessionAddress: session?.user?.walletAddress,
      finalWalletAddress: walletAddress,
      connectorClientAvailable: !!connectorClient,
      addressSource: address ? "wagmi" : session?.user?.walletAddress ? "session" : "none",
      sessionData: session?.user ? {
        walletAddress: session.user.walletAddress,
        // worldId: (session.user as any).worldId, // May not be available in session type
      } : "no session"
    });

    if (!walletAddress) {
      console.log("❌ No wallet address available from wagmi or session");
      return null;
    }

    console.log("✅ Wallet address resolved:", walletAddress);

    try {
      // If no connector client from wagmi, try to create one using MiniKit
      let provider = connectorClient;

      if (!provider) {
        console.log("No wagmi connector client, attempting to use MiniKit/fallbacks");

        // Try different provider sources in order of preference
        if (typeof window !== 'undefined') {
          // Try window.ethereum first (injected wallets)
          provider = (window as any).ethereum;
          console.log("Trying window.ethereum:", !!provider);

          // If no window.ethereum, try to create a minimal provider for MiniKit context
          if (!provider) {
            console.log("No window.ethereum, creating MiniKit-compatible provider");
            // Create a minimal provider that can work with ATXP
            // This assumes MiniKit handles the actual signing
            provider = {
              // Enhanced EIP-1193 compatible provider for MiniKit
              request: async ({ method, params }: { method: string; params?: any }) => {
                console.log("Provider request:", method, params);

                switch (method) {
                  case 'eth_accounts':
                    return [walletAddress];

                  case 'eth_chainId':
                    return '0x1e0'; // Worldchain chain ID (480)

                  case 'wallet_connect':
                  case 'wallet_requestPermissions':
                  case 'wallet_getPermissions':
                    console.log(`[atxp] ${method} not supported in MiniKit, continuing with initialization`);
                    return null; // Return null instead of throwing

                  case 'eth_requestAccounts':
                    return [walletAddress];

                  case 'net_version':
                    return '480'; // Worldchain network ID

                  case 'eth_sendTransaction':
                    // This would need to be handled by MiniKit's transaction flow
                    console.log("Transaction request in MiniKit context:", params);
                    throw new Error("Transactions must be handled through MiniKit");

                  case 'personal_sign':
                    // Handle personal_sign via MiniKit
                    console.log("personal_sign request:", params);
                    if (!params || params.length < 2) {
                      throw new Error("personal_sign requires message and address parameters");
                    }
                    const [message, address] = params;
                    console.log("Attempting to sign message via MiniKit:", {
                      message,
                      address,
                      messageType: typeof message,
                      messageLength: message?.length,
                      messageHex: message?.startsWith?.('0x'),
                      walletAddress
                    });

                    // Log the raw message for debugging
                    console.log("Raw message being signed:", message);
                    console.log("Message as hex:", message.startsWith('0x') ? message : `0x${Buffer.from(message, 'utf8').toString('hex')}`);

                    try {
                      const signResult = await MiniKit.commandsAsync.signMessage({
                        message: message,
                      });

                      if (signResult?.finalPayload?.status === 'success') {
                        console.log("MiniKit signing successful - DETAILED DEBUG:", {
                          signature: signResult.finalPayload.signature,
                          signatureLength: signResult.finalPayload.signature?.length,
                          signatureType: "EIP-191 compliant (from MiniKit docs)",
                          address: signResult.finalPayload.address,
                          walletAddress,
                          addressMatch: signResult.finalPayload.address === walletAddress,
                          version: signResult.finalPayload.version,
                          fullPayload: signResult.finalPayload
                        });

                        // CRITICAL DEBUG: Address consistency check
                        if (signResult.finalPayload.address !== walletAddress) {
                          console.error("🚨 CRITICAL: ADDRESS MISMATCH DETECTED!");
                          console.error("JWT will be signed with:", signResult.finalPayload.address);
                          console.error("But JWT payload will claim:", walletAddress);
                          console.error("This will cause ES256K verification to fail!");
                          console.error("Fix: Use the actual signing address in JWT payload");
                        }

                        if (signResult.finalPayload.address !== address) {
                          console.warn("⚠️ WARNING: Signing address mismatch");
                          console.warn("Requested address:", address);
                          console.warn("Actual signing address:", signResult.finalPayload.address);
                        }

                        // Log signature format analysis - back to ES256K mode
                        console.log("Signature Analysis for ATXP ES256K:", {
                          expectedAddress: walletAddress,
                          signingAddress: address,
                          miniKitAddress: signResult.finalPayload.address,
                          addressesMatch: address === walletAddress && signResult.finalPayload.address === walletAddress,
                          signaturePreview: signResult.finalPayload.signature?.substring(0, 20) + "...",
                          signatureLength: signResult.finalPayload.signature?.length,
                          expectedLength: "132 chars (0x + 64 bytes hex) for standard ECDSA",
                          atxpMode: "useEphemeralWallet: false → ES256K verification",
                          messageFormat: "JWT header.payload string for ES256K verification",
                          challenge: "MiniKit EIP-191 vs ES256K compatibility - trying legacy format"
                        });

                        return signResult.finalPayload.signature;
                      } else {
                        console.error("MiniKit signing failed:", signResult?.finalPayload);
                        throw new Error(`MiniKit signing failed: ${signResult?.finalPayload?.error_code}`);
                      }
                    } catch (error) {
                      console.error("MiniKit signing error:", error);
                      throw error;
                    }

                  case 'eth_sign':
                    // Similar to personal_sign but different format
                    console.log("eth_sign request:", params);
                    if (!params || params.length < 2) {
                      throw new Error("eth_sign requires address and message parameters");
                    }
                    const [ethSignAddress, ethSignMessage] = params;
                    console.log("Attempting eth_sign via MiniKit:", { address: ethSignAddress, message: ethSignMessage });

                    try {
                      const ethSignResult = await MiniKit.commandsAsync.signMessage({
                        message: ethSignMessage,
                      });

                      if (ethSignResult?.finalPayload?.status === 'success') {
                        console.log("MiniKit eth_sign successful:", ethSignResult.finalPayload);
                        return ethSignResult.finalPayload.signature;
                      } else {
                        console.error("MiniKit eth_sign failed:", ethSignResult?.finalPayload);
                        throw new Error(`MiniKit eth_sign failed: ${ethSignResult?.finalPayload?.error_code}`);
                      }
                    } catch (error) {
                      console.error("MiniKit eth_sign error:", error);
                      throw error;
                    }

                  case 'eth_signTypedData_v4':
                    // Handle typed data signing via MiniKit
                    console.log("eth_signTypedData_v4 request:", params);
                    if (!params || params.length < 2) {
                      throw new Error("eth_signTypedData_v4 requires address and typedData parameters");
                    }
                    const [typedDataAddress, typedData] = params;
                    console.log("Attempting typed data signing via MiniKit:", { address: typedDataAddress, typedData });

                    try {
                      // Parse typedData if it's a string
                      const parsedTypedData = typeof typedData === 'string' ? JSON.parse(typedData) : typedData;

                      const typedDataResult = await MiniKit.commandsAsync.signTypedData({
                        types: parsedTypedData.types,
                        domain: parsedTypedData.domain,
                        primaryType: parsedTypedData.primaryType,
                        message: parsedTypedData.message,
                      });

                      if (typedDataResult?.finalPayload?.status === 'success') {
                        console.log("MiniKit signTypedData successful:", typedDataResult.finalPayload);
                        return typedDataResult.finalPayload.signature;
                      } else {
                        console.error("MiniKit signTypedData failed:", typedDataResult?.finalPayload);
                        throw new Error(`MiniKit signTypedData failed: ${typedDataResult?.finalPayload?.error_code}`);
                      }
                    } catch (error) {
                      console.error("MiniKit signTypedData error:", error);
                      throw error;
                    }

                  default:
                    console.log(`[atxp] Method ${method} not implemented in MiniKit provider`);
                    throw new Error(`Method ${method} not supported in MiniKit context`);
                }
              },

              // Additional EIP-1193 properties
              isConnected: () => true,
              chainId: 480, // Worldchain
              networkVersion: '480',
              selectedAddress: walletAddress,

              // Add event listener methods (even if they're no-ops)
              on: (event: string, handler: any) => {
                console.log("Provider event listener added:", event);
              },
              removeListener: (event: string, handler: any) => {
                console.log("Provider event listener removed:", event);
              },
              off: (event: string, handler: any) => {
                console.log("Provider event listener removed:", event);
              },
            };
          }
        }
      }

      if (!provider) {
        console.log("No provider available after all attempts");
        throw new Error("No provider available for wallet connection");
      }

      console.log("Initializing ATXP account with:", {
        walletAddress,
        provider: provider.constructor?.name || 'MiniKit Provider',
        allowance: "10 USDC",
        useEphemeralWallet: false,
        periodInDays: 30,
        signatureMode: "ES256K (regular wallet mode - need signature compatibility solution)"
      });

      console.log("ATXP: Starting WorldAppAccount.initialize...");

      try {
        const tmpAtxpAccount = await WorldAppAccount.initialize({
          walletAddress,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: provider as any, // Type cast needed for client compatibility
          allowance: parseUnits("10", 6), // 10 USDC
          useEphemeralWallet: false, // Regular wallet mode (smart wallet infrastructure not available on World Chain)
          periodInDays: 30,
        });

        console.log("ATXP: WorldAppAccount.initialize completed successfully");

        // Let's try to get the JWT token if available for debugging
        if (tmpAtxpAccount && (tmpAtxpAccount as any).generateJWT) {
          try {
            const jwt = await (tmpAtxpAccount as any).generateJWT({
              paymentRequestId: "test-request-id",
              codeChallenge: "test-challenge"
            });

            const [headerB64, payloadB64, signatureB64] = jwt.split('.');
            const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

            console.log("ATXP JWT Debug:", {
              jwt: jwt,
              jwtLength: jwt?.length,
              jwtParts: jwt?.split('.').length,
              header,
              payload,
              signature: signatureB64
            });

            // CRITICAL DEBUG: Check for address consistency in JWT
            console.log("🔍 JWT ADDRESS VERIFICATION:", {
              walletAddress: walletAddress,
              jwtSubject: payload.sub,
              addressesMatch: walletAddress?.toLowerCase() === payload.sub?.toLowerCase(),
              jwtIssuer: payload.iss,
              jwtAudience: payload.aud,
              jwtAlgorithm: header.alg,
              expectedAlgorithm: "ES256K (secp256k1 ECDSA)",
              signatureFormat: "Should be hex with 0x prefix as base64url"
            });

            // If addresses don't match, this is the root cause of the issue
            if (walletAddress?.toLowerCase() !== payload.sub?.toLowerCase()) {
              console.error("🚨 ROOT CAUSE FOUND: JWT payload 'sub' doesn't match wallet address!");
              console.error("Wallet address:", walletAddress);
              console.error("JWT subject:", payload.sub);
              console.error("This means the signature will be for the wrong address!");
            } else {
              console.log("✅ JWT address consistency looks good");
            }

            // Verify the message being signed matches what ES256K verification expects
            const jwtMessage = `${headerB64}.${payloadB64}`;
            console.log("📝 JWT MESSAGE BEING SIGNED:", {
              message: jwtMessage,
              messageLength: jwtMessage.length,
              messagePreview: jwtMessage.substring(0, 100) + "...",
              note: "This exact string should be signed by MiniKit personal_sign"
            });

          } catch (jwtError) {
            console.log("Could not get JWT for debugging:", jwtError);
          }
        }

        // Log account type to understand if it's using smart wallet or regular wallet mode
        console.log("ATXP Account Details:", {
          accountAddress: tmpAtxpAccount.address,
          walletAddress: walletAddress,
          addressMatch: tmpAtxpAccount.address === walletAddress,
          accountType: tmpAtxpAccount.constructor.name,
          useEphemeralWallet: false, // Fixed: should match line 324
          expectedAlgorithm: "ES256K for regular wallet mode",
          signatureCompatibility: "MiniKit EIP-191 → ES256K verification via MainWalletPaymentMaker"
        });

        // Add comprehensive mode verification
        console.log("🔧 ATXP MODE VERIFICATION:", {
          configuredMode: "useEphemeralWallet: false",
          expectedBehavior: "ES256K signatures via MainWalletPaymentMaker",
          signingFlow: "MiniKit personal_sign → ES256K JWT → Backend verification",
          criticalNote: "Address in JWT 'sub' MUST match MiniKit signing address",
          backendVerification: "auth.atxp.ai/authorize endpoint expects ES256K"
        });

        return tmpAtxpAccount;
      } catch (initError) {
        console.error("ATXP initialization failed with detailed error:", {
          error: initError,
          message: initError.message,
          stack: initError.stack,
          walletAddress,
          providerType: provider.constructor?.name
        });
        throw initError;
      }

      console.log("ATXP account initialized successfully:", tmpAtxpAccount);
      setAtxpAccount(tmpAtxpAccount);
      return tmpAtxpAccount;
    } catch (error) {
      console.error("Error setting up ATXP account", error);
      return null;
    }
  }, [address, connectorClient, session?.user?.walletAddress]);

  // Auto-initialize ATXP account when we get an address (wagmi or session) and a provider
  useEffect(() => {
    const walletAddress = address || session?.user?.walletAddress;
    const hasProvider = connectorClient || (typeof window !== 'undefined' && (window as any).ethereum);

    if (walletAddress && !atxpAccount) {
      console.log("Triggering ATXP account initialization - walletAddress:", walletAddress, "hasProvider:", hasProvider);
      loadAtxp();
    }
  }, [address, connectorClient, session?.user?.walletAddress, atxpAccount, loadAtxp]);

  const clearAtxp = useCallback(() => {
    if (!address) return;
    WorldAppAccount.clearAllStoredData(address);
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
        console.log("🔐 Creating ATXP client for JWT transmission...");

        // CRITICAL DEBUG: This is where JWT generation and transmission will happen
        console.log("🚀 ATXP CLIENT INITIALIZATION:", {
          account: tmpAtxpAccount,
          mcpServer: IMAGE_SERVICE.mcpServer,
          walletAddress: tmpAtxpAccount?.address,
          note: "atxpClient() will call generateJWT() internally and send to backend"
        });

        // Try to generate a JWT manually before client creation for debugging
        try {
          if ((tmpAtxpAccount as any)?.generateJWT) {
            const debugJWT = await (tmpAtxpAccount as any).generateJWT({
              paymentRequestId: "image-generation-request",
              codeChallenge: "debug-challenge"
            });

            const [headerB64, payloadB64, signatureB64] = debugJWT.split('.');
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

            console.log("📋 JWT THAT WILL BE SENT TO BACKEND:", {
              fullJWT: debugJWT,
              jwtParts: debugJWT.split('.').length,
              payloadSubject: payload.sub,
              payloadIssuer: payload.iss,
              payloadAudience: payload.aud,
              messageLength: `${headerB64}.${payloadB64}`.length,
              signaturePreview: signatureB64.substring(0, 20) + "...",
              backendEndpoint: IMAGE_SERVICE.mcpServer,
              expectedVerification: "Backend will verify ES256K signature against payload.sub address"
            });

            // FINAL ADDRESS VERIFICATION
            if (payload.sub !== tmpAtxpAccount?.address) {
              console.error("🚨 FINAL CHECK: JWT subject doesn't match account address!");
              console.error("Account address:", tmpAtxpAccount?.address);
              console.error("JWT subject (sub):", payload.sub);
              console.error("This WILL cause ES256K verification to fail!");
            } else {
              console.log("✅ FINAL CHECK: JWT subject matches account address");
            }
          }
        } catch (jwtGenError) {
          console.error("Failed to generate debug JWT:", jwtGenError);
        }

        imageClient = await atxpClient({
          account: tmpAtxpAccount,
          mcpServer: IMAGE_SERVICE.mcpServer,
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
