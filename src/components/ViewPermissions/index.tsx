'use client';

import { ListItem } from '@worldcoin/mini-apps-ui-kit-react';
import { MiniKit } from '@worldcoin/minikit-js';
import { useMiniKit } from '@worldcoin/minikit-js/minikit-provider';
import { useEffect, useState } from 'react';
/**
 * This component is an example of how to view the permissions of a user
 * It's critical you use Minikit commands on client components
 * Read More: https://docs.world.org/mini-apps/commands/permissions
 */

export const ViewPermissions = () => {
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const { isInstalled } = useMiniKit();

  useEffect(() => {
    const fetchPermissions = () => {
      setIsLoading(true);
      if (isInstalled) {
        try {
          // Only use synchronous user.permissions to avoid event handler issues
          if (MiniKit.user?.permissions) {
            setPermissions(MiniKit.user.permissions);
            console.log('permissions from user', MiniKit.user.permissions);
          } else {
            // No permissions available synchronously
            console.log('No permissions available from MiniKit.user');
            setPermissions({});
          }
        } catch (error) {
          console.error('Failed to access permissions:', error);
          setPermissions({});
        }
      } else {
        console.log('MiniKit is not installed');
        setPermissions({});
      }
      setIsLoading(false);
    };
    fetchPermissions();
  }, [isInstalled]);

  return (
    <div className="grid w-full gap-4">
      <p className="text-lg font-semibold">Permissions</p>

      {isLoading && (
        <div className="flex items-center gap-2 p-4">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-600">Loading permissions...</span>
        </div>
      )}

      {!isLoading && Object.keys(permissions).length === 0 && (
        <p className="text-sm text-gray-600">No permissions available or MiniKit not connected.</p>
      )}

      {!isLoading && Object.keys(permissions).length > 0 &&
        Object.entries(permissions).map(([permission, value]) => (
          <ListItem
            key={permission}
            description={`Enabled: ${value}`}
            label={permission}
          />
        ))}
    </div>
  );
};
