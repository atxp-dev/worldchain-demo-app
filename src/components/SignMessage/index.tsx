'use client';
import { Button, LiveFeedback } from '@worldcoin/mini-apps-ui-kit-react';
import { MiniKit, SignMessageInput } from '@worldcoin/minikit-js';
import { useState } from 'react';
import { hashMessage, recoverMessageAddress, verifyMessage } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';
import { useSession } from 'next-auth/react';
import Safe from '@safe-global/protocol-kit';

/**
 * This component implements the MiniKit sign-message example from the documentation
 * It tests if the Safe-based verification works or if the MiniKit bug affects it
 */
export const SignMessage = () => {
  const [buttonState, setButtonState] = useState<
    'pending' | 'success' | 'failed' | undefined
  >(undefined);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const { address: wagmiAddress, addresses: wagmiAddresses } = useAccount();
  const { data: session } = useSession();
  const publicClient = usePublicClient();

  // Detect EIP-7702 authorization state (based on Privy docs)
  const checkEIP7702Authorization = async (address: string): Promise<{ isAuthorized: boolean; implementationAddress: string | null }> => {
    if (!publicClient) {
      console.error('[SignMessage Debug] No public client available');
      return { isAuthorized: false, implementationAddress: null };
    }

    try {
      const code = (await publicClient.getCode({ address: address as `0x${string}` }))?.toLowerCase() ?? '0x';
      const prefixIndex = code.indexOf('0xef0100');

      if (prefixIndex === -1) {
        console.log('[SignMessage Debug] No EIP-7702 authorization prefix found');
        return { isAuthorized: false, implementationAddress: null };
      }

      const implementationAddress = `0x${code.slice(prefixIndex + 8, prefixIndex + 48)}` as `0x${string}`;
      return {
        isAuthorized: true,
        implementationAddress
      };
    } catch (error) {
      console.error('[SignMessage Debug] Error checking EIP-7702 authorization:', error);
      return { isAuthorized: false, implementationAddress: null };
    }
  };

  // Get Safe owners using the standard Safe contract interface
  const getSafeOwners = async (safeAddress: string): Promise<string[]> => {
    if (!publicClient) return [];

    try {
      // Safe contract ABI for getOwners function
      const safeAbi = [
        {
          name: 'getOwners',
          type: 'function',
          inputs: [],
          outputs: [{ name: '', type: 'address[]' }],
          stateMutability: 'view'
        }
      ] as const;

      const owners = await publicClient.readContract({
        address: safeAddress as `0x${string}`,
        abi: safeAbi,
        functionName: 'getOwners'
      });

      return owners as string[];
    } catch (error) {
      console.error('[SignMessage Debug] Error getting Safe owners:', error);
      return [];
    }
  };

  const checkAddressRelationships = async () => {
    const sessionAddress = session?.user?.walletAddress;

    const addresses = {
      wagmiAddress,
      sessionAddress,
      currentWalletAddress: wagmiAddress || sessionAddress,
      safeOwners: [] as string[],
      eip7702Info: {} as Record<string, { isAuthorized: boolean; implementationAddress: string | null }>
    };

    console.log('[SignMessage Debug] Address Analysis:');
    console.log('[SignMessage Debug]   Wagmi Address (Safe?):', wagmiAddress);
    console.log('[SignMessage Debug]   Wagmi Addresses:', wagmiAddresses);
    console.log('[SignMessage Debug]   Session Address (from auth):', sessionAddress);
    console.log('[SignMessage Debug]   Current Wallet Address:', addresses.currentWalletAddress);
    console.log('[SignMessage Debug]   Addresses Match:', wagmiAddress?.toLowerCase() === sessionAddress?.toLowerCase());

    // Check if wagmiAddress is a Safe and get its owners
    if (wagmiAddress) {
      try {
        addresses.safeOwners = await getSafeOwners(wagmiAddress);
        console.log('[SignMessage Debug]   Safe Owners:', addresses.safeOwners);
      } catch (error) {
        console.log('[SignMessage Debug]   Not a Safe contract or error getting owners:', error);
      }

      // Check EIP-7702 authorization for wagmiAddress
      addresses.eip7702Info[wagmiAddress] = await checkEIP7702Authorization(wagmiAddress);
      console.log('[SignMessage Debug]   Wagmi EIP-7702:', addresses.eip7702Info[wagmiAddress]);
    }

    // Check EIP-7702 authorization for sessionAddress
    if (sessionAddress && sessionAddress !== wagmiAddress) {
      addresses.eip7702Info[sessionAddress] = await checkEIP7702Authorization(sessionAddress);
      console.log('[SignMessage Debug]   Session EIP-7702:', addresses.eip7702Info[sessionAddress]);
    }

    // Check if sessionAddress is one of the Safe owners
    if (sessionAddress && addresses.safeOwners.length > 0) {
      const isOwner = addresses.safeOwners.some(owner => owner.toLowerCase() === sessionAddress.toLowerCase());
      console.log('[SignMessage Debug]   Session address is Safe owner:', isOwner);
    }

    return addresses;
  };

  // Also check if any recovered signature address is a Safe owner
  const checkRecoveredAddressRelationship = async (recoveredAddr: string, safeAddress?: string) => {
    if (!safeAddress) return { isOwner: false, ownerIndex: -1 };

    try {
      const owners = await getSafeOwners(safeAddress);
      const ownerIndex = owners.findIndex(owner => owner.toLowerCase() === recoveredAddr.toLowerCase());
      const isOwner = ownerIndex !== -1;

      console.log(`[SignMessage Debug] Checking if ${recoveredAddr} is owner of Safe ${safeAddress}:`, isOwner);
      if (isOwner) {
        console.log(`[SignMessage Debug] Found as owner #${ownerIndex + 1} of ${owners.length} total owners`);
      }

      return { isOwner, ownerIndex, totalOwners: owners.length, allOwners: owners };
    } catch (error) {
      console.log(`[SignMessage Debug] Error checking Safe owners:`, error);
      return { isOwner: false, ownerIndex: -1 };
    }
  };

  // Verify signature using Safe SDK
  const verifySafeSignature = async (message: string, signature: string, safeAddress: string): Promise<{ isValid: boolean; error?: string }> => {
    try {
      console.log(`[SignMessage Debug] Initializing Safe SDK for ${safeAddress}`);

      const safe = await Safe.init({
        provider: 'https://worldchain-mainnet.g.alchemy.com/public',
        safeAddress: safeAddress,
      });

      console.log(`[SignMessage Debug] Safe SDK initialized successfully`);

      // Get message hash using viem (same as our other methods)
      const messageHash = hashMessage(message);
      console.log(`[SignMessage Debug] Using message hash: ${messageHash}`);

      // Use Safe's isValidSignature method
      const isValid = await safe.isValidSignature(messageHash, signature);

      console.log(`[SignMessage Debug] Safe isValidSignature result:`, isValid);

      return { isValid };
    } catch (error) {
      console.error(`[SignMessage Debug] Safe signature verification error:`, error);
      return {
        isValid: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  };

  const verifySignatureManually = async (message: string, signature: string, expectedAddress: string): Promise<{ recoveryValid: boolean; viemValid: boolean; recoveredAddress: string; debugInfo: any }> => {
    try {
      // Method 1: Use viem's recoverMessageAddress to verify the signature
      const recoveredAddress = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      });

      const recoveryValid = recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();

      // Get the message hash to understand what's being signed
      const messageHash = hashMessage(message);

      // Method 2: Use viem's verifyMessage function
      let viemValid = false;
      let viemError = null;
      try {
        viemValid = await verifyMessage({
          address: expectedAddress as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        });
      } catch (error) {
        viemError = error;
        console.log('[SignMessage Debug] verifyMessage error:', error);
      }

      // Additional debugging: try verifying with different message formats
      let alternativeTests: Record<string, any> = {};
      try {
        // Test 1: Verify with the message hash directly
        alternativeTests.hashVerify = await verifyMessage({
          address: expectedAddress as `0x${string}`,
          message: { raw: messageHash },
          signature: signature as `0x${string}`,
        });
      } catch (e) {
        alternativeTests.hashVerify = `Error: ${e}`;
      }

      // Test 2: Try with explicit message object
      try {
        alternativeTests.messageObjectVerify = await verifyMessage({
          address: expectedAddress as `0x${string}`,
          message: { raw: message as `0x${string}` },
          signature: signature as `0x${string}`,
        });
      } catch (e) {
        alternativeTests.messageObjectVerify = `Error: ${e}`;
      }

      const debugInfo = {
        messageHash,
        viemError,
        alternativeTests,
        signatureLength: signature.length,
        signatureFormat: signature.slice(0, 10) + '...',
        messageLength: message.length
      };

      console.log('[SignMessage Debug] Manual verification:');
      console.log('[SignMessage Debug]   Message:', message);
      console.log('[SignMessage Debug]   Message Hash:', messageHash);
      console.log('[SignMessage Debug]   Expected Address:', expectedAddress.toLowerCase());
      console.log('[SignMessage Debug]   Recovered Address:', recoveredAddress.toLowerCase());
      console.log('[SignMessage Debug]   Recovery Match:', recoveryValid);
      console.log('[SignMessage Debug]   Viem verifyMessage:', viemValid);
      console.log('[SignMessage Debug]   Viem Error:', viemError);
      console.log('[SignMessage Debug]   Alternative Tests:', alternativeTests);

      return {
        recoveryValid,
        viemValid,
        recoveredAddress: recoveredAddress.toLowerCase(),
        debugInfo
      };
    } catch (error) {
      console.error('[SignMessage Debug] Manual verification error:', error);
      throw error;
    }
  };

  const onClickSignMessage = async () => {
    setButtonState('pending');
    setDebugInfo('Analyzing addresses and relationships...');

    // Check address relationships first (now async)
    const addresses = await checkAddressRelationships();

    const safeOwnersInfo = addresses.safeOwners.length > 0 ?
      `\n🔐 Safe Owners Found:\n${addresses.safeOwners.map((owner, i) => `  ${i + 1}. ${owner}${owner.toLowerCase() === addresses.sessionAddress?.toLowerCase() ? ' ⭐ (Session Address!)' : ''}`).join('\n')}` :
      '\n🔍 No Safe owners found (not a Safe or error)';

    const eip7702Info = Object.entries(addresses.eip7702Info).map(([addr, info]) =>
      `• ${addr.slice(0, 8)}...${addr.slice(-6)}: ${info.isAuthorized ? `✅ Authorized → ${info.implementationAddress}` : '❌ Not authorized'}`
    ).join('\n');

    const initialDebugInfo = `Starting sign message test...

📋 Address Analysis:
• Wagmi Address (Safe?): ${addresses.wagmiAddress || 'Not connected'}
• Session Address (from auth): ${addresses.sessionAddress || 'Not available'}
• Current Wallet: ${addresses.currentWalletAddress || 'None'}
• Addresses Match: ${addresses.wagmiAddress?.toLowerCase() === addresses.sessionAddress?.toLowerCase() ? 'YES' : 'NO'}

${addresses.wagmiAddress && addresses.sessionAddress && addresses.wagmiAddress.toLowerCase() !== addresses.sessionAddress?.toLowerCase() ?
  '⚠️  Address mismatch detected! This suggests Wagmi shows Safe address but auth used EOA.' :
  '✅ Addresses consistent or only one source available.'}
${safeOwnersInfo}

🔗 EIP-7702 Authorization Status:
${eip7702Info || 'No addresses to check'}

${addresses.sessionAddress && addresses.safeOwners.length > 0 && addresses.safeOwners.some(owner => owner.toLowerCase() === addresses.sessionAddress?.toLowerCase()) ?
  '🎯 Session address IS a Safe owner! This is the expected EOA.' :
  addresses.safeOwners.length > 0 ? '⚠️  Session address is NOT a Safe owner.' : ''}
`;

    setDebugInfo(initialDebugInfo);

    try {
      const messageToSign = "Hello world from MiniKit test";

      const signMessagePayload: SignMessageInput = {
        message: messageToSign,
      };

      console.log('[SignMessage Debug] Requesting signature for:', messageToSign);
      const { finalPayload } = await MiniKit.commandsAsync.signMessage(signMessagePayload);

      console.log('[SignMessage Debug] MiniKit response:', finalPayload);

      if (finalPayload.status === "success") {
        // Analyze the signing address against our known addresses
        const signingAddressAnalysis = `
🔍 Signing Address Analysis:
• MiniKit Signing Address: ${finalPayload.address}
• Wagmi Address (Safe?): ${addresses.wagmiAddress || 'Not connected'}
• Session Address (EOA from auth): ${addresses.sessionAddress || 'Not available'}

🔄 Address Comparisons:
• Signing vs Wagmi: ${finalPayload.address?.toLowerCase() === addresses.wagmiAddress?.toLowerCase() ? '✅ MATCH' : '❌ DIFFERENT'}
• Signing vs Session: ${finalPayload.address?.toLowerCase() === addresses.sessionAddress?.toLowerCase() ? '✅ MATCH' : '❌ DIFFERENT'}
• Signing vs Safe Owners: ${addresses.safeOwners.length > 0 && addresses.safeOwners.some(owner => owner.toLowerCase() === finalPayload.address?.toLowerCase()) ? '✅ IS SAFE OWNER' : addresses.safeOwners.length > 0 ? '❌ NOT SAFE OWNER' : 'N/A (No Safe)'}

${finalPayload.address?.toLowerCase() === addresses.sessionAddress?.toLowerCase() ?
  '🎯 MiniKit signed with EOA from auth session!' :
  finalPayload.address?.toLowerCase() === addresses.wagmiAddress?.toLowerCase() ?
  '🔐 MiniKit signed with Wagmi address (Safe?)' :
  addresses.safeOwners.some(owner => owner.toLowerCase() === finalPayload.address?.toLowerCase()) ?
  '🔑 MiniKit signed with Safe owner EOA!' :
  '⚠️  MiniKit signed with unknown address!'}

✅ MiniKit signed successfully!
Address: ${finalPayload.address}
Signature: ${finalPayload.signature.slice(0, 20)}...`;

        setDebugInfo(initialDebugInfo + signingAddressAnalysis);

        // Manual signature verification with both viem methods
        try {
          console.log('[SignMessage Debug] Starting manual verification');

          const verificationResults = await verifySignatureManually(messageToSign, finalPayload.signature, finalPayload.address);

          // Verify using Safe SDK
          let safeVerificationResult = null;
          try {
            console.log('[SignMessage Debug] Starting Safe SDK verification...');
            safeVerificationResult = await verifySafeSignature(messageToSign, finalPayload.signature, finalPayload.address);
            console.log('[SignMessage Debug] Safe SDK verification complete:', safeVerificationResult);
          } catch (error) {
            console.error('[SignMessage Debug] Safe SDK verification failed:', error);
            safeVerificationResult = { isValid: false, error: String(error) };
          }

          // Check if the recovered address is a Safe owner
          let recoveredAddressRelationship = null;
          if (verificationResults.recoveredAddress !== finalPayload.address.toLowerCase()) {
            recoveredAddressRelationship = await checkRecoveredAddressRelationship(
              verificationResults.recoveredAddress,
              finalPayload.address
            );
            console.log('[SignMessage Debug] Recovered address relationship:', recoveredAddressRelationship);
          }

          // Test signature against the recovered address to confirm it's valid
          let recoveredAddressSigner = null;
          if (verificationResults.recoveredAddress !== finalPayload.address.toLowerCase()) {
            try {
              const recoveredTest = await verifySignatureManually(messageToSign, finalPayload.signature, verificationResults.recoveredAddress);
              if (recoveredTest.recoveryValid && recoveredTest.viemValid) {
                recoveredAddressSigner = { name: 'Recovered Address', addr: verificationResults.recoveredAddress };
              }
            } catch (e) {
              console.log('[SignMessage Debug] Could not verify against recovered address:', e);
            }
          }

          // Also test verification against all known addresses to find the actual signer
          const addressesToTest = [
            { name: 'MiniKit Address', addr: finalPayload.address },
            { name: 'Wagmi Address', addr: addresses.wagmiAddress },
            { name: 'Session Address', addr: addresses.sessionAddress },
            ...addresses.safeOwners.map((owner, i) => ({ name: `Safe Owner ${i + 1}`, addr: owner }))
          ].filter(item => item.addr && item.addr !== finalPayload.address);

          let actualSigner = null;
          for (const { name, addr } of addressesToTest) {
            if (!addr) continue;
            try {
              const testResult = await verifySignatureManually(messageToSign, finalPayload.signature, addr);
              if (testResult.recoveryValid && testResult.viemValid) {
                actualSigner = { name, addr };
                break;
              }
            } catch (e) {
              console.log(`[SignMessage Debug] Could not verify against ${name} (${addr}):`, e);
            }
          }

          const verificationSummary = `
🔍 Signature Verification Results:
• Address Recovery Match: ${verificationResults.recoveryValid ? '✅ VALID' : '❌ INVALID'}
• Viem verifyMessage: ${verificationResults.viemValid ? '✅ VALID' : '❌ INVALID'}
• Safe SDK isValidSignature: ${safeVerificationResult?.isValid ? '✅ VALID' : safeVerificationResult?.error ? `❌ ERROR: ${safeVerificationResult.error}` : '❌ INVALID'}
• Recovered Address: ${verificationResults.recoveredAddress}
• Expected Address: ${finalPayload.address.toLowerCase()}

🔧 Technical Details:
• Message: "${messageToSign}"
• Message Hash: ${verificationResults.debugInfo.messageHash}
• Signature Length: ${verificationResults.debugInfo.signatureLength}
• Signature: ${verificationResults.debugInfo.signatureFormat}

${verificationResults.debugInfo.viemError ? `🚨 Viem Error: ${verificationResults.debugInfo.viemError}` : ''}

🧪 Alternative Verification Tests:
• Hash Verify: ${verificationResults.debugInfo.alternativeTests.hashVerify}
• Message Object Verify: ${verificationResults.debugInfo.alternativeTests.messageObjectVerify}

${actualSigner ? `🎯 ACTUAL SIGNER FOUND: ${actualSigner.name} (${actualSigner.addr})
This confirms the signature was made by a different address than claimed!` : ''}

${recoveredAddressSigner ? `✅ RECOVERED ADDRESS VERIFICATION: ${recoveredAddressSigner.name} (${recoveredAddressSigner.addr})
The signature IS VALID for the recovered address! This confirms MiniKit bug.` :
verificationResults.recoveredAddress !== finalPayload.address.toLowerCase() ?
`⚠️  Could not verify signature against recovered address either.` : ''}

${recoveredAddressRelationship ? `🔗 Safe Owner Analysis:
• Recovered Address: ${verificationResults.recoveredAddress}
• Is Safe Owner: ${recoveredAddressRelationship.isOwner ? '✅ YES' : '❌ NO'}${recoveredAddressRelationship.isOwner ? `
• Owner Position: ${recoveredAddressRelationship.ownerIndex + 1} of ${recoveredAddressRelationship.totalOwners}` : ''}${recoveredAddressRelationship.allOwners && recoveredAddressRelationship.allOwners.length > 0 ? `
• All Safe Owners:
  ${recoveredAddressRelationship.allOwners.map((owner, i) => `${i + 1}. ${owner}`).join('\n  ')}` : ''}` : ''}

📊 Analysis:
${safeVerificationResult?.isValid ?
  `🎉 SAFE VERIFICATION SUCCESS!
  - Safe SDK confirms this signature IS VALID for the Safe contract
  - This suggests MiniKit's signature is legitimate Safe-style signing
  - The "recovered address" issue may be expected Safe behavior` :
  verificationResults.recoveryValid && verificationResults.viemValid ?
  '🎉 Both viem verification methods confirm signature is VALID!' :
  recoveredAddressSigner ?
  `🔥 MINIKIT BUG CONFIRMED:
  - MiniKit claims signature from: ${finalPayload.address} (Safe contract)
  - Signature actually from: ${verificationResults.recoveredAddress} (EOA)
  - Safe SDK verification: ${safeVerificationResult?.isValid ? 'VALID' : 'INVALID'}
  ${recoveredAddressRelationship?.isOwner ?
    `- ✅ Recovered address IS a Safe owner (${recoveredAddressRelationship.ownerIndex + 1}/${recoveredAddressRelationship.totalOwners})
  - This suggests MiniKit should return the actual signer, not the Safe address!` :
    `- ❌ Recovered address is NOT a Safe owner
  - This indicates a more serious key management issue in MiniKit!`}` :
  actualSigner ?
  `⚠️  Signature is INVALID for claimed address but VALID for ${actualSigner.name}!
This confirms MiniKit is returning the wrong address.` :
  verificationResults.recoveredAddress !== finalPayload.address.toLowerCase() ?
  `🚨 SIGNATURE ISSUE:
  - Claimed signer: ${finalPayload.address}
  - Recovered signer: ${verificationResults.recoveredAddress}
  - Neither verification method works - possible signature corruption.` :
  verificationResults.recoveryValid !== verificationResults.viemValid ?
  `⚠️  Verification methods disagree!
Recovery works (${verificationResults.recoveryValid}) but verifyMessage fails (${verificationResults.viemValid}).
This suggests a message formatting issue between viem methods.` :
  '❌ Both methods confirm signature is INVALID - signature verification failed.'}

${!verificationResults.recoveryValid && verificationResults.recoveredAddress !== finalPayload.address.toLowerCase() ?
  `🔍 Recovered vs Claimed:
   Claimed: ${finalPayload.address.toLowerCase()}
   Recovered: ${verificationResults.recoveredAddress}` : ''}`;

          if (verificationResults.recoveryValid && verificationResults.viemValid) {
            setButtonState('success');
          } else if (actualSigner) {
            setButtonState('failed'); // Still failed because claimed address is wrong
          } else {
            setButtonState('failed');
          }

          setDebugInfo(prev => prev + verificationSummary);

        } catch (verifyError) {
          console.error('[SignMessage Debug] Manual verification error:', verifyError);
          setButtonState('failed');
          setDebugInfo(prev => prev + `\n\n🚨 Manual verification ERROR:\n${verifyError instanceof Error ? verifyError.message : String(verifyError)}`);
        }
      } else {
        setButtonState('failed');
        setDebugInfo(`❌ MiniKit signing failed:\nStatus: ${finalPayload.status}`);
      }
    } catch (error) {
      console.error('[SignMessage Debug] Overall error:', error);
      setButtonState('failed');
      setDebugInfo(`🚨 Sign message failed:\n${error instanceof Error ? error.message : String(error)}`);

      setTimeout(() => {
        setButtonState(undefined);
      }, 5000);
    }
  };

  return (
    <div className="grid w-full gap-4">
      <p className="text-lg font-semibold">Sign Message Test</p>
      <p className="text-sm text-gray-600">
        Tests MiniKit's signMessage using Safe validation from documentation
      </p>

      {debugInfo && (
        <div className="bg-gray-100 p-3 rounded text-sm whitespace-pre-wrap font-mono text-xs">
          {debugInfo}
        </div>
      )}

      <LiveFeedback
        label={{
          failed: 'Sign message failed',
          pending: 'Signing message...',
          success: 'Message signed & verified!',
        }}
        state={buttonState}
        className="w-full"
      >
        <Button
          onClick={onClickSignMessage}
          disabled={buttonState === 'pending'}
          size="lg"
          variant="primary"
          className="w-full"
        >
          Test Sign Message
        </Button>
      </LiveFeedback>
    </div>
  );
};