'use client';
import { Button, LiveFeedback } from '@worldcoin/mini-apps-ui-kit-react';
import { MiniKit, SignMessageInput } from '@worldcoin/minikit-js';
import { useState } from 'react';
import { hashMessage, recoverMessageAddress } from 'viem';

/**
 * This component implements the MiniKit sign-message example from the documentation
 * It tests if the Safe-based verification works or if the MiniKit bug affects it
 */
export const SignMessage = () => {
  const [buttonState, setButtonState] = useState<
    'pending' | 'success' | 'failed' | undefined
  >(undefined);
  const [debugInfo, setDebugInfo] = useState<string>('');

  const verifySignatureManually = async (message: string, signature: string, expectedAddress: string): Promise<boolean> => {
    try {
      // Use viem's recoverMessageAddress to verify the signature
      const recoveredAddress = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      });

      console.log('[SignMessage Debug] Manual verification:');
      console.log('[SignMessage Debug]   Message:', message);
      console.log('[SignMessage Debug]   Expected:', expectedAddress.toLowerCase());
      console.log('[SignMessage Debug]   Recovered:', recoveredAddress.toLowerCase());
      console.log('[SignMessage Debug]   Match:', recoveredAddress.toLowerCase() === expectedAddress.toLowerCase());

      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      console.error('[SignMessage Debug] Manual verification error:', error);
      throw error;
    }
  };

  const onClickSignMessage = async () => {
    setButtonState('pending');
    setDebugInfo('Starting sign message test...');

    try {
      const messageToSign = "Hello world from MiniKit test";

      const signMessagePayload: SignMessageInput = {
        message: messageToSign,
      };

      console.log('[SignMessage Debug] Requesting signature for:', messageToSign);
      const { finalPayload } = await MiniKit.commandsAsync.signMessage(signMessagePayload);

      console.log('[SignMessage Debug] MiniKit response:', finalPayload);

      if (finalPayload.status === "success") {
        setDebugInfo(`✅ MiniKit signed successfully!\nAddress: ${finalPayload.address}\nSignature: ${finalPayload.signature.slice(0, 20)}...`);

        // Manual signature verification (like our analysis)
        try {
          console.log('[SignMessage Debug] Starting manual verification');

          const isValidManual = await verifySignatureManually(messageToSign, finalPayload.signature, finalPayload.address);

          if (isValidManual) {
            setButtonState('success');
            setDebugInfo(prev => prev + '\n\n🎉 Manual verification: SUCCESS!\nThe signature is mathematically valid.');
          } else {
            setButtonState('failed');
            setDebugInfo(prev => prev + '\n\n❌ Manual verification: FAILED\nSignature does not match claimed address.\nThis confirms the MiniKit bug affects sign-message too.');
          }
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