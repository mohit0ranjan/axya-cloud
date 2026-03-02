import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { X, CloudUpload, CheckCircle, AlertCircle } from 'lucide-react-native';
import * as Progress from 'react-native-progress';

export interface UploadTask {
    id: string;
    fileName: string;
    fileSize: number;
    progress: number;
    status: 'queued' | 'uploading' | 'completed' | 'failed' | 'cancelled' | 'pending';
    error?: string;
}

interface UploadProgressProps {
    task: UploadTask;
    onCancel: (id: string) => void;
}

const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const UploadProgress: React.FC<UploadProgressProps> = ({ task, onCancel }) => {
    const isError = task.status === 'failed';
    const isCompleted = task.status === 'completed';

    const getStatusText = () => {
        if (isCompleted) return 'Upload complete';
        if (isError) return task.error || 'Upload failed';
        if (task.status === 'queued') return 'Waiting in queue...';
        return `Uploading... ${task.progress}%`;
    };

    const getStatusIcon = () => {
        if (isCompleted) return <CheckCircle size={14} color="#1FD45A" />;
        if (isError) return <AlertCircle size={14} color="#EF4444" />;
        return <CloudUpload size={14} color="#4B6EF5" />;
    };

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <View style={styles.info}>
                    <Text style={styles.fileName} numberOfLines={1}>{task.fileName}</Text>
                    <View style={styles.statusRow}>
                        {getStatusIcon()}
                        <Text style={[
                            styles.statusText,
                            isError ? styles.statusError : null,
                            isCompleted ? styles.statusSuccess : null
                        ]}>
                            {getStatusText()}
                        </Text>
                        <Text style={styles.sizeText}>· {formatFileSize(task.fileSize)}</Text>
                    </View>
                </View>
                {!isCompleted && !isError && (
                    <TouchableOpacity onPress={() => onCancel(task.id)} style={styles.cancelBtn}>
                        <X size={18} color="#8892A4" />
                    </TouchableOpacity>
                )}
            </View>

            <View style={styles.progressContainer}>
                <Progress.Bar
                    progress={task.progress / 100}
                    width={null}
                    height={6}
                    color={isError ? '#EF4444' : (isCompleted ? '#1FD45A' : '#4B6EF5')}
                    unfilledColor="#F4F6FB"
                    borderWidth={0}
                    borderRadius={10}
                    style={styles.progressBar}
                />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#1A1F36',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 3,
        borderWidth: 1,
        borderColor: '#F1F3F9',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    info: {
        flex: 1,
        gap: 2,
    },
    fileName: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1A1F36',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#4B6EF5',
    },
    statusError: {
        color: '#EF4444',
    },
    statusSuccess: {
        color: '#1FD45A',
    },
    sizeText: {
        fontSize: 12,
        color: '#8892A4',
        fontWeight: '500',
    },
    cancelBtn: {
        padding: 4,
        borderRadius: 8,
        backgroundColor: '#F8F9FC',
    },
    progressContainer: {
        width: '100%',
    },
    progressBar: {
        width: '100%',
    }
});

export default UploadProgress;
