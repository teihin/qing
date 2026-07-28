package audio

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

type EncoderFactory interface {
	Start(ctx context.Context, outputPath string) (Encoder, error)
	Check() error
}

type Encoder interface {
	WritePCM(data []byte) error
	Finish() error
	Abort()
}

type FFmpegFactory struct {
	path       string
	sampleRate int
	channels   int
	bitrate    string
}

func NewFFmpegFactory(path string, sampleRate, channels int, bitrate string) *FFmpegFactory {
	return &FFmpegFactory{
		path:       path,
		sampleRate: sampleRate,
		channels:   channels,
		bitrate:    bitrate,
	}
}

func (f *FFmpegFactory) Check() error {
	resolved, err := exec.LookPath(f.path)
	if err != nil {
		return fmt.Errorf("find ffmpeg executable %q: %w", f.path, err)
	}
	f.path = resolved
	return nil
}

func (f *FFmpegFactory) Start(ctx context.Context, outputPath string) (Encoder, error) {
	childContext, cancel := context.WithCancel(ctx)
	command := exec.CommandContext(
		childContext,
		f.path,
		"-hide_banner",
		"-loglevel", "error",
		"-nostdin",
		"-y",
		"-f", "s16le",
		"-ar", fmt.Sprintf("%d", f.sampleRate),
		"-ac", fmt.Sprintf("%d", f.channels),
		"-i", "pipe:0",
		"-vn",
		"-c:a", "aac",
		"-b:a", f.bitrate,
		"-movflags", "+faststart",
		"-f", "mp4",
		outputPath,
	)

	stdin, err := command.StdinPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("open ffmpeg stdin: %w", err)
	}
	stderr := &limitedBuffer{limit: 16 * 1024}
	command.Stderr = stderr

	if err := command.Start(); err != nil {
		_ = stdin.Close()
		cancel()
		return nil, fmt.Errorf("start ffmpeg: %w", err)
	}

	return &ffmpegEncoder{
		command: command,
		stdin:   stdin,
		cancel:  cancel,
		stderr:  stderr,
	}, nil
}

type ffmpegEncoder struct {
	mu       sync.Mutex
	command  *exec.Cmd
	stdin    io.WriteCloser
	cancel   context.CancelFunc
	stderr   *limitedBuffer
	finished bool
}

func (e *ffmpegEncoder) WritePCM(data []byte) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.finished {
		return errors.New("audio encoder is already closed")
	}
	if len(data) == 0 {
		return nil
	}
	if _, err := e.stdin.Write(data); err != nil {
		return fmt.Errorf("write PCM to ffmpeg: %w", err)
	}
	return nil
}

func (e *ffmpegEncoder) Finish() error {
	e.mu.Lock()
	if e.finished {
		e.mu.Unlock()
		return errors.New("audio encoder is already closed")
	}
	e.finished = true
	stdin := e.stdin
	command := e.command
	stderr := e.stderr
	e.mu.Unlock()

	closeErr := stdin.Close()
	waitErr := command.Wait()
	e.cancel()
	if closeErr != nil && !errors.Is(closeErr, io.ErrClosedPipe) {
		return fmt.Errorf("close ffmpeg input: %w", closeErr)
	}
	if waitErr != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = waitErr.Error()
		}
		return fmt.Errorf("ffmpeg encoding failed: %s", message)
	}
	return nil
}

func (e *ffmpegEncoder) Abort() {
	e.mu.Lock()
	if e.finished {
		e.mu.Unlock()
		return
	}
	e.finished = true
	stdin := e.stdin
	command := e.command
	cancel := e.cancel
	e.mu.Unlock()

	cancel()
	_ = stdin.Close()
	if command.Process != nil {
		_ = command.Process.Kill()
	}
	_ = command.Wait()
}

type limitedBuffer struct {
	buffer bytes.Buffer
	limit  int
}

func (b *limitedBuffer) Write(data []byte) (int, error) {
	originalLength := len(data)
	remaining := b.limit - b.buffer.Len()
	if remaining > 0 {
		if len(data) > remaining {
			data = data[:remaining]
		}
		_, _ = b.buffer.Write(data)
	}
	return originalLength, nil
}

func (b *limitedBuffer) String() string {
	return b.buffer.String()
}
