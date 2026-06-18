import { Request } from '../lib/protobuf/request/common_pb'
import { YouTubeMessage } from './youtube'

export default class RequestMessage extends YouTubeMessage {
  constructor (msgType: any = Request, name: string = 'Request') {
    super(msgType, name)
  }

  pure (): this {
    if (this.argument.blockAdSignals && this.message.context?.adSignalsInfo?.params?.length) {
      this.message.context.adSignalsInfo.params.length = 0
      this.needProcess = true
    }
    return this
  }
}
