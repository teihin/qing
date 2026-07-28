#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

#include <math.h>

int main(void)
{
    @autoreleasepool {
        const double inputRate = 48000.0;
        const double outputRate = 16000.0;
        AVAudioFormat *inputFormat =
            [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32
                                             sampleRate:inputRate
                                               channels:2
                                            interleaved:NO];
        AVAudioFormat *outputFormat =
            [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16
                                             sampleRate:outputRate
                                               channels:1
                                            interleaved:NO];
        AVAudioConverter *converter =
            [[AVAudioConverter alloc] initFromFormat:inputFormat toFormat:outputFormat];
        if (converter == nil) {
            return 1;
        }

        NSUInteger totalFrames = 0;
        BOOL hasSignal = NO;
        double phase = 0.0;
        for (NSUInteger chunkIndex = 0; chunkIndex < 100; chunkIndex++) {
            AVAudioPCMBuffer *input =
                [[AVAudioPCMBuffer alloc] initWithPCMFormat:inputFormat
                                              frameCapacity:480];
            input.frameLength = 480;
            for (NSUInteger frame = 0; frame < input.frameLength; frame++) {
                float sample = (float)(sin(phase) * 0.35);
                phase += 2.0 * M_PI * 440.0 / inputRate;
                input.floatChannelData[0][frame] = sample;
                input.floatChannelData[1][frame] = sample;
            }

            AVAudioFrameCount capacity =
                (AVAudioFrameCount)ceil((double)input.frameLength
                    * outputRate / inputRate) + 64;
            AVAudioPCMBuffer *output =
                [[AVAudioPCMBuffer alloc] initWithPCMFormat:outputFormat
                                              frameCapacity:capacity];
            __block BOOL suppliedInput = NO;
            NSError *error = nil;
            AVAudioConverterOutputStatus status =
                [converter convertToBuffer:output
                                     error:&error
                        withInputFromBlock:^AVAudioBuffer *(
                            AVAudioPacketCount requestedPackets,
                            AVAudioConverterInputStatus *outStatus) {
                if (suppliedInput) {
                    *outStatus = AVAudioConverterInputStatus_NoDataNow;
                    return nil;
                }
                suppliedInput = YES;
                *outStatus = AVAudioConverterInputStatus_HaveData;
                return input;
            }];
            if (status == AVAudioConverterOutputStatus_Error || error != nil) {
                NSLog(@"converter error: %@", error);
                return 2;
            }
            if (output.int16ChannelData == nil) {
                return 3;
            }
            totalFrames += output.frameLength;
            for (NSUInteger frame = 0; frame < output.frameLength; frame++) {
                int16_t sample = output.int16ChannelData[0][frame];
                if (sample > 1 || sample < -1) {
                    hasSignal = YES;
                    break;
                }
            }
        }

        NSLog(@"convertedFrames=%lu hasSignal=%@",
              (unsigned long)totalFrames,
              hasSignal ? @"YES" : @"NO");
        return totalFrames >= 15900 && totalFrames <= 16100 && hasSignal ? 0 : 4;
    }
}
