"""Agent Cut's local Chatterbox adapter. No model downloads or network inference."""
import os
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', DO_NOT_TRACK='1', TOKENIZERS_PARALLELISM='false')
import sys, json, pathlib, socket, wave, time, contextlib, importlib.metadata

def denied(*args, **kwargs):
    raise RuntimeError('Chatterbox generation is offline. Install all model files through explicit setup first.')
socket.create_connection = denied
socket.socket.connect = denied
socket.socket.connect_ex = denied
socket.getaddrinfo = denied

def main(request):
    # Third-party model logging must not contaminate the structured response.
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        import numpy as np
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        import inspect
        if 'nano' not in inspect.signature(ChatterboxTurboTTS.from_local).parameters:
            raise RuntimeError('This Chatterbox version lacks Nano/local loading. Install the documented pinned build.')
        cuda = torch.cuda.is_available()
        version = importlib.metadata.version('chatterbox-tts')
        if request['action'] == 'probe':
            return {'version':version, 'torch':torch.__version__, 'perth':importlib.metadata.version('resemble-perth'), 'cudaAvailable':cuda, 'gpu':torch.cuda.get_device_name(0) if cuda else None, 'python':sys.version.split()[0]}
        device = request['device']
        if device == 'auto': device = 'cuda' if cuda else 'cpu'
        if device == 'cuda' and not cuda: raise RuntimeError('CUDA is unavailable in this Python runtime. Select CPU or install the CUDA-enabled PyTorch build.')
        torch.set_num_threads(request['threads'])
        torch.manual_seed(42)
        started = time.monotonic()
        model = ChatterboxTurboTTS.from_local(request['modelDir'], device=device, nano=request['model'] == 'nano')
        if request.get('referencePath'):
            model.prepare_conditionals(request['referencePath'])
        output = pathlib.Path(request['outputDir'])
        def progress(index):
            temp=output/'speech-progress.tmp'
            temp.write_text(json.dumps({'completed':index,'total':len(request['chunks']),'device':device}),encoding='utf-8')
            os.replace(temp,output/'speech-progress.json')
        progress(0)
        with torch.inference_mode():
            for index, chunk in enumerate(request['chunks']):
                audio=model.generate(chunk['text']).detach().cpu().float().reshape(-1).numpy()
                if not np.isfinite(audio).all() or len(audio) < model.sr * .05 or len(audio) > model.sr * 30 or np.max(np.abs(audio)) < .00001:
                    raise RuntimeError('Model returned empty, invalid or unexpectedly long speech. Retry this phrase or choose another voice reference.')
                pcm=(np.clip(audio,-1,1)*32767).astype('<i2')
                with wave.open(str(output/('part-'+str(index)+'.wav')),'wb') as target:
                    target.setnchannels(1); target.setsampwidth(2); target.setframerate(model.sr); target.writeframes(pcm.tobytes())
                progress(index+1)
        return {'engine':'chatterbox','model':request['model'],'version':version,'device':device,'sampleRate':model.sr,'peakCudaBytes':torch.cuda.max_memory_allocated() if device=='cuda' else None,'parts':len(request['chunks']),'seconds':round(time.monotonic()-started,2),'offline':True,'watermark':'Upstream Perth watermark retained'}

if __name__ == '__main__':
    try:
        request_path=pathlib.Path(sys.argv[1]).resolve()
        cache=request_path.parent/'runtime-cache'
        cache.mkdir(exist_ok=True)
        os.environ.update(TEMP=str(cache), TMP=str(cache), NUMBA_CACHE_DIR=str(cache/'numba'), CUDA_CACHE_PATH=str(cache/'cuda'))
        import tempfile
        tempfile.tempdir=str(cache)
        request=json.loads(request_path.read_text(encoding='utf-8-sig'))
        print(json.dumps(main(request)))
    except Exception as error:
        print(type(error).__name__+': '+str(error),file=sys.stderr)
        sys.exit(1)
