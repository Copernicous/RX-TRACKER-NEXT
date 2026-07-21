using NAudio.Wave;

namespace RxSoftphone;

/// <summary>
/// Plays a conventional North American ring cadence through the default
/// Windows output device. SIP signaling controls when it starts and stops;
/// it does not depend on RTP early media from the PBX.
/// </summary>
public sealed class LocalRingTone : IDisposable
{
    private readonly object _sync = new();
    private WaveOutEvent? _output;

    public bool IsPlaying
    {
        get
        {
            lock (_sync)
            {
                return _output?.PlaybackState == PlaybackState.Playing;
            }
        }
    }

    public bool Start()
    {
        lock (_sync)
        {
            if (_output?.PlaybackState == PlaybackState.Playing)
            {
                return false;
            }

            StopCore();
            var output = new WaveOutEvent
            {
                DesiredLatency = 100,
                NumberOfBuffers = 3
            };

            try
            {
                output.Init(new RingbackSampleProvider());
                output.Play();
                _output = output;
                return true;
            }
            catch
            {
                output.Dispose();
                throw;
            }
        }
    }

    public void Stop()
    {
        lock (_sync)
        {
            StopCore();
        }
    }

    private void StopCore()
    {
        var output = _output;
        _output = null;
        if (output is null)
        {
            return;
        }

        try
        {
            output.Stop();
        }
        finally
        {
            output.Dispose();
        }
    }

    public void Dispose() => Stop();

    private sealed class RingbackSampleProvider : ISampleProvider
    {
        private const int SampleRate = 44_100;
        private const double LowFrequency = 440.0;
        private const double HighFrequency = 480.0;
        private const double ToneSeconds = 2.0;
        private const double CadenceSeconds = 6.0;
        private const double EdgeRampSeconds = 0.012;
        private const float Volume = 0.18f;

        private readonly long _toneSamples = (long)(SampleRate * ToneSeconds);
        private readonly long _cadenceSamples = (long)(SampleRate * CadenceSeconds);
        private readonly long _edgeRampSamples = (long)(SampleRate * EdgeRampSeconds);
        private readonly double _lowStep = 2 * Math.PI * LowFrequency / SampleRate;
        private readonly double _highStep = 2 * Math.PI * HighFrequency / SampleRate;
        private long _samplePosition;
        private double _lowPhase;
        private double _highPhase;

        public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(SampleRate, 1);

        public int Read(float[] buffer, int offset, int count)
        {
            for (var index = 0; index < count; index++)
            {
                var cadencePosition = _samplePosition % _cadenceSamples;
                float envelope = 0;
                if (cadencePosition < _toneSamples)
                {
                    var attack = Math.Min(1.0, (double)cadencePosition / _edgeRampSamples);
                    var release = Math.Min(1.0, (double)(_toneSamples - cadencePosition) / _edgeRampSamples);
                    envelope = (float)Math.Min(attack, release);
                }

                var sample = (Math.Sin(_lowPhase) + Math.Sin(_highPhase)) * 0.5;
                buffer[offset + index] = (float)sample * Volume * envelope;

                _lowPhase += _lowStep;
                _highPhase += _highStep;
                if (_lowPhase >= 2 * Math.PI) _lowPhase -= 2 * Math.PI;
                if (_highPhase >= 2 * Math.PI) _highPhase -= 2 * Math.PI;
                _samplePosition++;
            }

            return count;
        }
    }
}
