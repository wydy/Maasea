import createMessage from '../lib/factory'
import RequestMessage from './requestHandler'
import { $ } from '../lib/env'

const handleRequestBodyBytes = (bodyBytes: Uint8Array): Uint8Array => {
  const requestMsg = new RequestMessage()
  try {
    return requestMsg.fromBinary(bodyBytes).pure().toBinary()
  } catch (e) {
    $.log(e.toString())
    return bodyBytes
  }
}

const handleResponse = (response: CFetchResponse): void => {
  const responseMsg = createMessage($.request.url)

  if (responseMsg) {
    try {
      const body = response.bodyBytes as Uint8Array
      responseMsg.fromBinary(body).pure().done(response)
    } catch (e) {
      console.log(e.toString())
    }
  } else {
    $.exit()
  }
}

export const checkSurgeVersion = (): void => {
  const build = parseInt($environment?.['surge-build'])
  if (isNaN(build) || build < 2700) {
    $.msg(
      'YouTubeAds Beta',
      'Unsupported Surge version',
      'Tap to install the legacy module',
      'https://raw.githubusercontent.com/Maasea/sgmodule/master/YoutubeAds.sgmodule'
    )
    $.exit()
  }
}

export const buildRequest = async (): Promise<void> => {
  const bodyBytes = handleRequestBodyBytes($.request.bodyBytes as Uint8Array)
  try {
    const response = await $.fetch({
      ...$.request,
      bodyBytes
    })
    handleResponse(response)
  } catch (e) {
    $.log(e.toString())
    $.exit()
  }
}
