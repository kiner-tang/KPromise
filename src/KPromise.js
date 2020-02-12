import {identity, isFn, warn, isObj} from "./utils.js";
import {STATUS} from "./constants.js";

class KPromise {
    constructor(handle) {
        // 若传入的参数不是函数则警告并退出
        if (!isFn(handle)) {
            warn(`KPromise实例化时必须传入一个函数作为参数,当前传入参数类型为：${typeof handle}`);
            return;
        }
        // 内置状态
        this.status = STATUS.PENDING;
        // 成功回调调用栈
        this.fulFilledCbs = [];
        // 失败回调调用栈
        this.rejectedCbs = [];

        // 结果
        this.value = undefined;
        // 失败的原因
        this.reason = undefined;


        // 定义成功处理函数
        const _resolve = val => {

            // 如果传进来的val也是一个KPromise对象
            if(val instanceof KPromise){
                return val.then(_resolve, _reject);
            }

            //
            // Promises/A+规范明确要求回调需要通过异步方式执行，用以保证一致可靠的执行顺序。
            //
            // 之所以放到setTimeout中，是为了确保在调用回调之前，所有的then都已经执行完了
            // 原理：setTimeout是宏任务，根据javascript的EventLoop的调用顺序：先执行主线程，发现有宏任务则加入到宏任务队列中，继续执行主线程，知道主线程
            // 执行完毕，会去宏任务队列中看一下有没有任务，如果有，就拿出一个来执行（在EventLoop中还有微任务的调用逻辑，但此处不涉及，因此未说明）
            // 因此：把回调方法的调用放入到setTimeout中去，js会先执行完主线程（将所有的then的回调收集完毕之后），再回来执行setTimeout中的逻辑，
            // 这样就能保证一致可靠的执行顺序了
            setTimeout(() => {
                // 当且仅当当前状态在请求中时才能触发成功回调
                if (this.status === STATUS.PENDING) {
                    // 将结果记录下来，并修正当前状态为得到预期结果
                    this.value = val;
                    this.status = STATUS.FULFILLED;

                    // 使用管道函数调用方式
                    this.fulFilledCbs.forEach(fn=>fn(this.value));
                }
            })


        };
        // 定义失败处理函数
        const _reject = reason => {
            setTimeout(() => {
                // 当且仅当当前状态在请求中时才能触发失败回调
                if (this.status === STATUS.PENDING) {
                    this.status = STATUS.REJECTED;
                    this.reason = reason;

                    this.rejectedCbs.forEach(fn=>fn(this.reason));
                }
            });

        };

        // 在try-catch中指定传过来的handle
        try {
            handle(_resolve, _reject);
        } catch (e) {
            _reject(e);
        }

    }



    /**
     * 实现then方法
     * @param resolveHandle     成功回调
     * @param rejectHandle      失败回调
     * @returns {KPromise}
     */
    then(resolveHandle, rejectHandle) {
        // 对传入参数进行预处理，如果传入的参数是不是function类型，则直接替换成一个identity函数
        resolveHandle = isFn(resolveHandle) ? resolveHandle : identity;
        // 当rejectHandle不是一个函数时，默认使用reason => { throw reason;}这个函数抛出异常，用以解决一下问题
        //
        // 2.2.1: Both `onFulfilled` and `onRejected` are optional arguments.
        //     2.2.1.1: If `onFulfilled` is not a function, it must be ignored.
        //       applied to a directly-rejected promise
        //         ✓ `onFulfilled` is `undefined`
        //         ✓ `onFulfilled` is `null`
        //         ✓ `onFulfilled` is `false`
        //         ✓ `onFulfilled` is `5`
        //         ✓ `onFulfilled` is an object
        //       applied to a promise rejected and then chained off of
        //         1) `onFulfilled` is `undefined`
        //         2) `onFulfilled` is `null`
        //         3) `onFulfilled` is `false`
        //         4) `onFulfilled` is `5`
        //         5) `onFulfilled` is an object
        rejectHandle = isFn(rejectHandle) ? rejectHandle : reason => { throw reason;};

        // 统一处理成功状态
        let resolveFulfilled = (newPromise, val,resolve, reject) => {
            try{
                // 运行resolveHandle,若这个方法有返回值，则把这个返回值作为下一个then调用的参数
                // e.g.
                // let p1 = new KPromise((resolve, reject)=>resolve(1)).then(res=>res+1).then(res=>{console.log(res)});
                // 上面console.log输出的结果是2，因为第一个then中把他接收的参数1进行了加一并返回，那么第二个then接受到的res便是2;
                let res = resolveHandle(val);
                // 将上一个then的返回结果交由resolveProse继续处理
                KPromise.resolvePromise(newPromise, res, resolve, reject)
            }catch (e) {
                // 若运行报错则直接reject
                reject(e);
            }
        };
        /**
         * 统一处理失败状态
         * @param newPromise
         * @param reason
         * @param resolve
         * @param reject
         */
        let resolveRejected = (newPromise, reason,resolve, reject) => {
            try{
                // 处理逻辑同resolveFulfilled
                let res = rejectHandle(reason);
                KPromise.resolvePromise(newPromise, res, resolve, reject)
            }catch (e) {
                reject(e);
            }
        };

        // 当状态是pending时，才将回调加入到fulFilledCbs、rejectedCbs中
        // 因为要保证KPromise的链式调用，因此，始终需要返回一个KPromise的实例，而我们的具体逻辑，如状态为pending时需要将处理逻辑加入到对应的数组中等
        if (this.status === STATUS.PENDING) {
            const newPromise = new KPromise((resolve, reject) => {
                this.fulFilledCbs.push(val=>resolveFulfilled(newPromise, val, resolve, reject));
                this.rejectedCbs.push(reason=>resolveRejected(newPromise, reason, resolve, reject));
            });
            return newPromise;
        } else if (this.status === STATUS.FULFILLED) {
            const newPromise = new KPromise((resolve, reject)=>{
                // 由于promise/A+规范规定回调需要通过setTimeout、setImmediate等方式异步调用，因此将对成功太的处理逻辑放入setTimeout中
                setTimeout(()=>{
                    resolveFulfilled(newPromise, this.value, resolve, reject)
                });
            });
            return newPromise;
        } else {
            const newPromise = new KPromise((resolve, reject)=>{
                setTimeout(()=>{
                    resolveRejected(newPromise, this.reason, resolve, reject)
                });
            });
            return newPromise;
        }
    }

    /**
     * 实现then方法
     * 描述：
     * then已经实现相关逻辑，直接调用即可
     * @param handle
     * @returns {KPromise}
     */
    catch(handle){
        return this.then(null, handle);
    };

    /**
     * 统一处理promise的返回
     * @param newPromise    新的promise
     * @param res           上一次的返回
     * @param resolve       新的resolve
     * @param reject        新的reject
     */
    static resolvePromise(newPromise, res, resolve, reject){
        // 如果新传入的Promise对象与上一次返回的res相同，则说明出现了循环引用，直接抛出异常
        if(newPromise===res){
            throw new TypeError('新的promise不能与上一个promise是同一个实例');
        }

        // 用于标记是否调用过，避免反复被调用
        let flag = false;

        // 以下（1~7）判断本来是为了判断res如果是KPromise的实例的情况的处理，但其实这个判断已经跟下面的判断有所重合了，只要是KPromise的实例，那么他必然会有then函数，就会进入第7行之后的的判断逻辑
        // 因此，这个判断其实是没必要的。
        // 1. if(res instanceof KPromise){
        // 2.     if(res.status === STATUS.PENDING){// 当传入值为等待状态是，等待其返回并将返回值重新递归传回给resolvePromise进行处理
        // 3.         res.then(newRes => KPromise.resolvePromise(newPromise, newRes, resolve, reject), reason => reject(reason));
        // 4.     }else{// 若res不是等待状态，那么他的值已经被处理过了，直接传递给then进行下一步处理
        // 5.         res.then(resolve, reject);
        // 6.     }
        // 7. } else
        if(res!==null &&  (isFn(res)||isObj(res))){// 如果是函数的话需要递归调用下一层

            try{
                // 看一下传进来的res是否含有then，并且then是一个函数
                let then = res.then;
                // 如果then是一个方法，那么调用这个方法处理下一个逻辑
                if(isFn(then)){
                    then.call(res, r => !flag&&(flag = true)&&KPromise.resolvePromise(newPromise, r, resolve, reject), reason => !flag&&(flag = true)&&reject(reason));
                }else{// 如果then是一个对象或普通函数（即没有实现then的函数）,那么直接resolve这个函数
                    resolve(res);
                }
            }catch (e) {
                if(flag) return;
                flag = true;
                reject(e);
            }

        }else{//如果不是的话直接用resolve返回
            resolve(res);
        }
    }

    /**
     * 实现Promise.all静态方法
     * 描述：
     * all方法必须传入的promise数组中的每一个promise对象都是完成态才能够成功并进入到then回调中，否则进入到catch回调中
     * @param promises
     * @returns {KPromise}
     */
    static all(promises){
        return new KPromise((resolve, reject)=>{
            // 用于处于完成态的结果,为了确保结果数组的顺序跟传入的promises的顺序相对应，使用WeakMap对象进行存储，使用promises中的每一个promise作为key
            let map = new WeakMap(),count = 0;
            // 循环数组，在每一个promise对象的then中将其结果加入到arr中
            let i = promises.length;
            while (i--){
                let p = promises[i];
                p.then(res=>{
                    map.set(p, res);
                    count++;
                    // 当完成态结果的数量与promises数组的长度相等时，说明所有promise都成功了，直接resolve,并将暂存的完成态结果数组当做参数传递股偶去
                    if(count===promises.length){
                        resolve(promises.map(key=>map.get(key)));
                    }
                }).catch(reason=>{
                    // 如果失败使用reject退出
                    reject(reason);
                });
            }
        });
    };

    /**
     * 实现Promise.race方法
     * 描述：
     * 给定promise数组中，任意一个成功便完成
     * @param promises  KPromise对象数组
     * @returns {KPromise}
     */
    static race(promises){
        return new KPromise((resolve, reject)=>promises.forEach(promise=>promise.then(resolve,reject)));
    };

    /**
     * 实现Promise.resolve静态方法
     * @param val
     * @returns {KPromise}
     */
    static resolve(val){
        return new KPromise((resolve, reject) => {
            resolve(val);
        })
    };

    /**
     * 实现Promise.reject静态方
     * @param reason
     * @returns {KPromise}
     */
    static reject(reason){
        return new KPromise((resolve, reject) => {
            reject(reason)
        })
    };

    /**
     * 实现deferred,提供给测试代码使用
     */
    static deferred(){
        let defer = {};
        defer.promise = new KPromise((resolve, reject)=>{
            defer.resolve = resolve;
            defer.reject = reject;
        });
        return defer;
    }

}



export default KPromise;