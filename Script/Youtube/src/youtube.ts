import { Message, WireType } from '@bufbuild/protobuf'
import { $ } from '../lib/env'

export abstract class YouTubeMessage {
  name: string
  needProcess: boolean
  needSave: boolean
  message: any
  version = '1.0'
  whiteNo: number[]
  blackNo: number[]
  whiteEml: string[]
  blackEml: string[]
  msgType: Message<any>
  argument: Record<string, any>
  decoder = new TextDecoder('utf-8', {
    fatal: false,
    ignoreBOM: true
  })

  protected constructor (msgType: Message<any>, name: string) {
    $.log(name)
    this.name = name
    this.msgType = msgType
    const config = $.getJSON('YouTubeAdvertiseInfo', {
      version: this.version,
      whiteNo: [],
      blackNo: [],
      whiteEml: [],
      blackEml: ['inline_injection_entrypoint_layout.eml']
    }) as any
    if (config.version === this.version) Object.assign(this, config)
    this.argument = this.decodeArgument()
  }

  decodeArgument (): Record<string, any> {
    const defaultArgument = {
      lyricLang: 'off',
      captionLang: 'off',
      blockUpload: true,
      blockImmersive: true,
      blockShorts: false,
      blockAdSignals: true,
      debug: false
    }
    return typeof $argument === 'string' && !$argument.includes('{{{')
      ? Object.assign(defaultArgument, JSON.parse($argument))
      : defaultArgument
  }

  fromBinary (binaryBody: Uint8Array): YouTubeMessage {
    this.message = this.msgType.fromBinary(binaryBody)
    return this
  }

  abstract pure (): Promise<YouTubeMessage> | YouTubeMessage

  async modify (): Promise<YouTubeMessage> {
    const pureMessage = this.pure()
    if (pureMessage instanceof Promise) {
      return await pureMessage
    } else {
      return pureMessage
    }
  }

  toBinary (): Uint8Array {
    return this.message.toBinary()
  }

  listUnknownFields (msg: any): ReadonlyArray<{ no: number, wireType: WireType, data: Uint8Array }> {
    if (msg instanceof Message) {
      return msg.getType().runtime.bin.listUnknownFields(msg)
    }
    return []
  }

  removeKnownAdFields (msg: any, fieldNos: number[]): void {
    if (!(msg instanceof Message)) return
    const fields = this.listUnknownFields(msg)
    if (!fields.length) return

    const keptFields = fields.filter((field) => {
      return !fieldNos.includes(field.no) || !this.checkBufferIsAd(field)
    })
    if (keptFields.length === fields.length) return

    msg.getType().runtime.bin.discardUnknownFields(msg)
    keptFields.forEach((field) => {
      msg.getType().runtime.bin.onUnknownField(msg, field.no, field.wireType, field.data)
    })
    this.needProcess = true
  }

  save (): void {
    if (this.needSave) {
      $.log('Update Config')
      const YouTubeAdvertiseInfo = {
        version: this.version,
        whiteNo: this.whiteNo,
        blackNo: this.blackNo,
        whiteEml: this.whiteEml,
        blackEml: this.blackEml
      }
      $.setJSON(YouTubeAdvertiseInfo, 'YouTubeAdvertiseInfo')
    }
  }

  done (response: CFetchResponse): void {
    this.save()
    let body = response.bodyBytes
    if (this.needProcess) body = this.toBinary()

    response.headers['Content-Encoding'] = 'identity'
    response.headers['Content-Length'] = (body?.length ?? 0)?.toString()

    $.done({
      response: {
        ...response,
        bodyBytes: body
      }
    })
  }

  doneResponse (): void {
    this.save()
    if (this.needProcess) {
      $.done({ bodyBytes: this.toBinary() })
    } else {
      $.exit()
    }
  }

  iterate (obj: any = {}, target: string | symbol, call: Function): boolean {
    const stack: any[] = (typeof obj === 'object') ? [obj] : []
    while (stack.length) {
      const item = stack.pop()
      const keys = Object.keys(item)

      if (typeof target === 'symbol') {
        for (const s of Object.getOwnPropertySymbols(item)) {
          if (s.description === target.description) {
            if (call(item, stack)) return true
            break
          }
        }
      }

      for (const key of keys) {
        if (key === target) {
          if (call(item, stack)) return true
        } else if (typeof item[key] === 'object') {
          stack.push(item[key])
        }
      }
    }
    return false
  }

  isAdvertise (o: Message<any>): boolean {
    const filed = this.listUnknownFields(o)[0]
    return filed ? this.handleFieldNo(filed) : this.handleFieldEml(o)
  }

  handleFieldNo (field): boolean {
    const no = field.no
    // 增加白名单直接跳过用于提升性能
    if (this.whiteNo.includes(no)) {
      return false
    } else if (this.blackNo.includes(no)) {
      return true
    }
    // 包含 pagead 字符则判定为广告
    const adFlag = this.checkBufferIsAd(field)
    adFlag ? this.blackNo.push(no) : this.whiteNo.push(no)
    this.needSave = true
    return adFlag
  }

  handleFieldEml (field): boolean {
    let adFlag = false
    let eml = ''
    this.iterate(field, 'renderInfo', (obj, stack) => {
      eml = obj.renderInfo.layoutRender.eml.split('|')[0]
      if (this.whiteEml.includes(eml)) {
        adFlag = false
      } else if (this.blackEml.includes(eml) || /shorts(?!_pivot_item)/.test(eml)) {
        adFlag = true
      } else {
        const videoContent = obj?.videoInfo?.videoContext?.videoContent
        if (videoContent) {
          adFlag = this.checkUnknownFiled(videoContent)
          adFlag ? this.blackEml.push(eml) : this.whiteEml.push(eml)
          this.needSave = true
        }
      }
      stack.length = 0
    })
    return adFlag
  }

  isShorts (field): boolean {
    let flag = false
    this.iterate(field, 'eml', (obj, stack) => {
      flag = /shorts(?!_pivot_item)/.test(obj.eml)
      stack.length = 0
    })
    return flag
  }

  checkBufferIsAd (field): boolean {
    if (!field || field.data.length < 1000) return false
    const data = field.data as Uint8Array
    return this.checkBytesIncludePagead(data)
  }

  checkBytesIncludePagead (data: Uint8Array): boolean {
    const pagead = [112, 97, 103, 101, 97, 100]
    const last = data.length - pagead.length
    for (let i = 0; i <= last; i++) {
      if (
        data[i] === pagead[0] &&
        data[i + 1] === pagead[1] &&
        data[i + 2] === pagead[2] &&
        data[i + 3] === pagead[3] &&
        data[i + 4] === pagead[4] &&
        data[i + 5] === pagead[5]
      ) {
        return true
      }
    }
    return false
  }

  checkMessageIsAd (msg: Message<any> | undefined): boolean {
    return msg ? this.checkBytesIncludePagead(msg.toBinary()) : false
  }

  checkUnknownFiled (field): boolean {
    return field ? this.listUnknownFields(field)?.some((item) => this.checkBufferIsAd(item)) ?? false : false
  }
}
