/**
 * Platform Alert Abstraction
 * 
 * Provides a unified alert/confirm API that works across:
 * - iOS (native Alert)
 * - Android (native Alert)
 * - Web (window.alert/confirm)
 * 
 * Usage:
 *   showAlert('Title', 'Message');
 *   showConfirm('Delete?', 'Are you sure?', onConfirm, onCancel);
 *   showActionSheet('Options', actions);
 */

import { Platform, Alert, AlertButton, AlertOptions } from 'react-native';

export interface ConfirmOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
}

export interface ActionSheetOption {
    text: string;
    onPress?: () => void;
    destructive?: boolean;
}

/**
 * Show a simple alert dialog
 */
export function showAlert(
    title: string,
    message?: string,
    buttonText?: string
): void {
    if (Platform.OS === 'web') {
        window.alert(message ? `${title}\n\n${message}` : title);
    } else {
        Alert.alert(title, message, [
            { text: buttonText || 'OK' }
        ]);
    }
}

/**
 * Show a confirmation dialog with Yes/No options
 */
export function showConfirm(
    options: ConfirmOptions
): Promise<boolean> {
    return new Promise((resolve) => {
        if (Platform.OS === 'web') {
            const fullMessage = options.message 
                ? `${options.title}\n\n${options.message}`
                : options.title;
            const result = window.confirm(fullMessage);
            resolve(result);
        } else {
            const buttons: AlertButton[] = [
                {
                    text: options.cancelText || 'Cancel',
                    style: 'cancel',
                    onPress: () => resolve(false),
                },
                {
                    text: options.confirmText || 'OK',
                    style: options.destructive ? 'destructive' : 'default',
                    onPress: () => resolve(true),
                },
            ];
            Alert.alert(options.title, options.message, buttons);
        }
    });
}

/**
 * Show an action sheet with multiple options (mobile) or confirm dialog (web)
 */
export function showActionSheet(
    title: string,
    message: string | undefined,
    actions: ActionSheetOption[],
    cancelText?: string
): void {
    if (Platform.OS === 'web') {
        const choice = window.prompt(`${title}\n${message || ''}\n\n${actions.map((a, i) => `${i + 1}. ${a.text}`).join('\n')}\n\nEnter an option number, or cancel.`);
        if (!choice || !/^\d+$/.test(choice.trim())) return;
        const action = actions[Number(choice) - 1];
        if (!action) return;
        if (!action.destructive || window.confirm(`${action.text}?`)) action.onPress?.();
    } else {
        const buttons: AlertButton[] = actions.map(action => ({
            text: action.text,
            style: action.destructive ? 'destructive' : 'default',
            onPress: action.onPress,
        }));
        
        // Add cancel button
        buttons.push({
            text: cancelText || 'Cancel',
            style: 'cancel',
        });
        
        Alert.alert(title, message, buttons);
    }
}

/**
 * Show a destructive action confirmation (delete, remove, etc.)
 */
export async function showDestructiveConfirm(
    title: string,
    message: string,
    actionText: string = 'Delete'
): Promise<boolean> {
    return showConfirm({
        title,
        message,
        confirmText: actionText,
        cancelText: 'Cancel',
        destructive: true,
    });
}

/**
 * Show an error alert
 */
export function showError(
    title: string,
    message?: string
): void {
    showAlert(title, message, 'OK');
}

/**
 * Show a success message
 */
export function showSuccess(
    title: string,
    message?: string
): void {
    showAlert(title, message, 'Great!');
}

/**
 * Legacy compatibility wrapper for Alert.alert
 * Use this as a drop-in replacement for Alert.alert calls
 */
export const PlatformAlert = {
    alert: (
        title: string,
        message?: string,
        buttons?: AlertButton[],
        options?: AlertOptions
    ): void => {
        if (Platform.OS === 'web') {
            // On web, handle simple cases
            if (!buttons || buttons.length === 0) {
                window.alert(message ? `${title}\n\n${message}` : title);
                return;
            }

            if (buttons.filter(b => b.style !== 'cancel').length > 1) {
                showActionSheet(title, message, buttons.filter(b => b.style !== 'cancel').map(b => ({text: b.text, onPress: b.onPress, destructive: b.style === 'destructive'})));
                return;
            }
            // Both ordinary and destructive confirmations must offer Cancel.
            const destructiveButton = buttons.find(b => b.style === 'destructive');
            const cancelButton = buttons.find(b => b.style === 'cancel');
            const defaultButton = buttons.find(b => !b.style || b.style === 'default');

            const actionButton = destructiveButton || defaultButton;
            if (actionButton && cancelButton) {
                const confirmed = window.confirm(
                    `${title}\n\n${message || ''}\n\nPress OK to ${actionButton.text.toLowerCase()}.`
                );
                if (confirmed) {
                    actionButton.onPress?.();
                } else {
                    cancelButton.onPress?.();
                }
                return;
            }

            // Default: just show alert and trigger the default button
            window.alert(message ? `${title}\n\n${message}` : title);
            defaultButton?.onPress?.();
        } else {
            Alert.alert(title, message, buttons, options);
        }
    },
};

export default PlatformAlert;
