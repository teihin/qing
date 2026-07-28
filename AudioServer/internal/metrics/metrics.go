package metrics

import (
	"fmt"
	"io"
	"sync/atomic"
)

type Metrics struct {
	activeConnections atomic.Int64
	activeRecordings  atomic.Int64
	uploadSuccess     atomic.Uint64
	uploadFailure     atomic.Uint64
	pcmBytesReceived  atomic.Uint64
	voicesDeleted     atomic.Uint64
}

func (m *Metrics) ConnectionOpened() {
	m.activeConnections.Add(1)
}

func (m *Metrics) ConnectionClosed() {
	m.activeConnections.Add(-1)
}

func (m *Metrics) RecordingStarted() {
	m.activeRecordings.Add(1)
}

func (m *Metrics) RecordingStopped() {
	m.activeRecordings.Add(-1)
}

func (m *Metrics) UploadSucceeded() {
	m.uploadSuccess.Add(1)
}

func (m *Metrics) UploadFailed() {
	m.uploadFailure.Add(1)
}

func (m *Metrics) AddPCMBytes(count int) {
	if count > 0 {
		m.pcmBytesReceived.Add(uint64(count))
	}
}

func (m *Metrics) AddDeletedVoices(count int) {
	if count > 0 {
		m.voicesDeleted.Add(uint64(count))
	}
}

func (m *Metrics) WritePrometheus(writer io.Writer) {
	_, _ = fmt.Fprintf(writer, "# TYPE audio_server_active_connections gauge\n")
	_, _ = fmt.Fprintf(writer, "audio_server_active_connections %d\n", m.activeConnections.Load())
	_, _ = fmt.Fprintf(writer, "# TYPE audio_server_active_recordings gauge\n")
	_, _ = fmt.Fprintf(writer, "audio_server_active_recordings %d\n", m.activeRecordings.Load())
	_, _ = fmt.Fprintf(writer, "# TYPE audio_server_upload_success_total counter\n")
	_, _ = fmt.Fprintf(writer, "audio_server_upload_success_total %d\n", m.uploadSuccess.Load())
	_, _ = fmt.Fprintf(writer, "# TYPE audio_server_upload_failure_total counter\n")
	_, _ = fmt.Fprintf(writer, "audio_server_upload_failure_total %d\n", m.uploadFailure.Load())
	_, _ = fmt.Fprintf(writer, "# TYPE audio_server_pcm_bytes_received_total counter\n")
	_, _ = fmt.Fprintf(writer, "audio_server_pcm_bytes_received_total %d\n", m.pcmBytesReceived.Load())
	_, _ = fmt.Fprintf(writer, "# TYPE audio_server_voices_deleted_total counter\n")
	_, _ = fmt.Fprintf(writer, "audio_server_voices_deleted_total %d\n", m.voicesDeleted.Load())
}
