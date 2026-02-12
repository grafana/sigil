package object

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"hash/fnv"
	"sort"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/proto"
)

const (
	formatVersion uint16 = 1

	dataFileMagic  = "SIGILDAT"
	indexFileMagic = "SIGILIDX"

	dataHeaderSize  = 8 + 2 + 4 + 8
	dataFooterSize  = 4
	indexHeaderSize = 8 + 2 + 4
	indexEntrySize  = 8 + 8 + 8 + 8 + 8
)

func EncodeBlock(block *storage.Block) ([]byte, []byte, *storage.BlockIndex, error) {
	if block == nil {
		return nil, nil, nil, errors.New("block is required")
	}
	if block.ID == "" {
		return nil, nil, nil, errors.New("block.id is required")
	}

	sorted := make([]storage.GenerationRecord, len(block.Generations))
	copy(sorted, block.Generations)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].CreatedAt.Equal(sorted[j].CreatedAt) {
			return sorted[i].GenerationID < sorted[j].GenerationID
		}
		return sorted[i].CreatedAt.Before(sorted[j].CreatedAt)
	})

	dataBytes, index := encodeData(sorted)
	indexBytes := encodeIndex(index)
	return dataBytes, indexBytes, index, nil
}

func DecodeData(data []byte) ([]*sigilv1.Generation, error) {
	if len(data) < dataHeaderSize+dataFooterSize {
		return nil, errors.New("data file is too small")
	}
	if string(data[:8]) != dataFileMagic {
		return nil, errors.New("invalid data file magic")
	}

	version := binary.LittleEndian.Uint16(data[8:10])
	if version != formatVersion {
		return nil, fmt.Errorf("unsupported data format version %d", version)
	}

	expectedCount := int(binary.LittleEndian.Uint32(data[10:14]))
	bodyEnd := len(data) - dataFooterSize
	body := data[dataHeaderSize:bodyEnd]

	checksum := binary.LittleEndian.Uint32(data[bodyEnd:])
	if crc32.ChecksumIEEE(body) != checksum {
		return nil, errors.New("data file checksum mismatch")
	}

	generations := make([]*sigilv1.Generation, 0, expectedCount)
	for len(body) > 0 {
		length, n := binary.Uvarint(body)
		if n <= 0 {
			return nil, errors.New("invalid record length prefix")
		}
		body = body[n:]
		if uint64(len(body)) < length {
			return nil, errors.New("record length exceeds remaining body")
		}

		payload := body[:length]
		body = body[length:]

		var generation sigilv1.Generation
		if err := proto.Unmarshal(payload, &generation); err != nil {
			return nil, fmt.Errorf("decode generation payload: %w", err)
		}
		generations = append(generations, &generation)
	}

	if len(generations) != expectedCount {
		return nil, fmt.Errorf("generation count mismatch: expected %d got %d", expectedCount, len(generations))
	}

	return generations, nil
}

func DecodeIndex(indexData []byte) (*storage.BlockIndex, error) {
	if len(indexData) < indexHeaderSize {
		return nil, errors.New("index file is too small")
	}
	if string(indexData[:8]) != indexFileMagic {
		return nil, errors.New("invalid index file magic")
	}

	version := binary.LittleEndian.Uint16(indexData[8:10])
	if version != formatVersion {
		return nil, fmt.Errorf("unsupported index format version %d", version)
	}

	count := int(binary.LittleEndian.Uint32(indexData[10:14]))
	expectedSize := indexHeaderSize + count*indexEntrySize
	if len(indexData) != expectedSize {
		return nil, fmt.Errorf("index file size mismatch: expected %d got %d", expectedSize, len(indexData))
	}

	index := &storage.BlockIndex{Entries: make([]storage.IndexEntry, 0, count)}
	offset := indexHeaderSize
	for i := 0; i < count; i++ {
		entry := storage.IndexEntry{
			GenerationIDHash:   binary.LittleEndian.Uint64(indexData[offset : offset+8]),
			ConversationIDHash: binary.LittleEndian.Uint64(indexData[offset+8 : offset+16]),
			Timestamp:          time.Unix(0, int64(binary.LittleEndian.Uint64(indexData[offset+16:offset+24]))).UTC(),
			Offset:             int64(binary.LittleEndian.Uint64(indexData[offset+24 : offset+32])),
			Length:             int64(binary.LittleEndian.Uint64(indexData[offset+32 : offset+40])),
		}
		index.Entries = append(index.Entries, entry)
		offset += indexEntrySize
	}

	return index, nil
}

func FindEntriesByConversationID(index *storage.BlockIndex, conversationID string) []storage.IndexEntry {
	if index == nil || conversationID == "" {
		return nil
	}
	hash := hashID(conversationID)
	entries := make([]storage.IndexEntry, 0)
	for _, entry := range index.Entries {
		if entry.ConversationIDHash == hash {
			entries = append(entries, entry)
		}
	}
	return entries
}

func FindEntriesByGenerationID(index *storage.BlockIndex, generationID string) []storage.IndexEntry {
	if index == nil || generationID == "" {
		return nil
	}
	hash := hashID(generationID)
	entries := make([]storage.IndexEntry, 0)
	for _, entry := range index.Entries {
		if entry.GenerationIDHash == hash {
			entries = append(entries, entry)
		}
	}
	return entries
}

func encodeData(records []storage.GenerationRecord) ([]byte, *storage.BlockIndex) {
	var data bytes.Buffer
	header := make([]byte, dataHeaderSize)
	copy(header[:8], []byte(dataFileMagic))
	binary.LittleEndian.PutUint16(header[8:10], formatVersion)
	binary.LittleEndian.PutUint32(header[10:14], uint32(len(records)))
	data.Write(header)

	index := &storage.BlockIndex{Entries: make([]storage.IndexEntry, 0, len(records))}
	for _, record := range records {
		var lengthPrefix [binary.MaxVarintLen64]byte
		lengthPrefixSize := binary.PutUvarint(lengthPrefix[:], uint64(len(record.Payload)))

		recordStart := int64(data.Len())
		data.Write(lengthPrefix[:lengthPrefixSize])
		data.Write(record.Payload)

		index.Entries = append(index.Entries, storage.IndexEntry{
			GenerationIDHash:   hashID(record.GenerationID),
			ConversationIDHash: hashID(record.ConversationID),
			Timestamp:          record.CreatedAt.UTC(),
			Offset:             recordStart + int64(lengthPrefixSize),
			Length:             int64(len(record.Payload)),
		})
	}

	bodyEnd := uint64(data.Len())
	binary.LittleEndian.PutUint64(data.Bytes()[14:22], bodyEnd)

	body := data.Bytes()[dataHeaderSize:]
	checksum := crc32.ChecksumIEEE(body)
	var footer [dataFooterSize]byte
	binary.LittleEndian.PutUint32(footer[:], checksum)
	data.Write(footer[:])

	return data.Bytes(), index
}

func encodeIndex(index *storage.BlockIndex) []byte {
	if index == nil {
		return nil
	}

	entries := make([]storage.IndexEntry, len(index.Entries))
	copy(entries, index.Entries)
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Timestamp.Equal(entries[j].Timestamp) {
			if entries[i].GenerationIDHash == entries[j].GenerationIDHash {
				return entries[i].Offset < entries[j].Offset
			}
			return entries[i].GenerationIDHash < entries[j].GenerationIDHash
		}
		return entries[i].Timestamp.Before(entries[j].Timestamp)
	})

	var out bytes.Buffer
	header := make([]byte, indexHeaderSize)
	copy(header[:8], []byte(indexFileMagic))
	binary.LittleEndian.PutUint16(header[8:10], formatVersion)
	binary.LittleEndian.PutUint32(header[10:14], uint32(len(entries)))
	out.Write(header)

	for _, entry := range entries {
		var encoded [indexEntrySize]byte
		binary.LittleEndian.PutUint64(encoded[0:8], entry.GenerationIDHash)
		binary.LittleEndian.PutUint64(encoded[8:16], entry.ConversationIDHash)
		binary.LittleEndian.PutUint64(encoded[16:24], uint64(entry.Timestamp.UTC().UnixNano()))
		binary.LittleEndian.PutUint64(encoded[24:32], uint64(entry.Offset))
		binary.LittleEndian.PutUint64(encoded[32:40], uint64(entry.Length))
		out.Write(encoded[:])
	}

	return out.Bytes()
}

func hashID(value string) uint64 {
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(value))
	return hasher.Sum64()
}
